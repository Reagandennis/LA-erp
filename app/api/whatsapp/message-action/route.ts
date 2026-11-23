import { NextRequest, NextResponse } from 'next/server';

import { mediaKindFromMime } from '@/lib/messaging-ingest';
import { readCache, writeCache } from '@/lib/messaging-media-cache';
import {
  applyMessageEdit,
  applyMessageRevoke,
  applyReactions,
  getChat,
  getMessage,
  recordOutgoing,
} from '@/lib/messaging-repo';
import { isReactionEmoji } from '@/lib/messaging-reactions';
import { resolveMessagingRequest } from '@/lib/messaging-routes';
import {
  editMessage,
  getMedia,
  getMessageSender,
  linkedJid,
  revokeMessage,
  sendMedia,
  sendReaction,
  sendText,
} from '@/lib/wacli';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

const ACTIONS = ['react', 'edit', 'revoke', 'forward'] as const;
type Action = (typeof ACTIONS)[number];

/** WhatsApp caps a message at 65,536 characters; the console's box is far smaller. */
const MAX_TEXT = 4096;

/**
 * Act on one message in one of the caller's own chats.
 *
 *   POST { action: 'react',   chatId, messageId, emoji }   emoji from REACTION_EMOJI, or '' to remove ours
 *   POST { action: 'edit',    chatId, messageId, text }    our own text message, within WhatsApp's window
 *   POST { action: 'revoke',  chatId, messageId }          delete our own message for everyone
 *   POST { action: 'forward', chatId, messageId, to }      send a copy to another of our chats
 *
 * Each change is made on WhatsApp first, then written to the mirror so the
 * console shows it at once. Only the actions above are accepted, and nothing
 * from the body reaches wacli except ids, the chosen emoji and message text,
 * all passed as arguments, never through a shell.
 *
 * Forwarding re-sends the message's content rather than using WhatsApp's own
 * forward: wacli's forward needs the store lock the live sync holds, and a
 * copy that arrives at once is worth more than the "Forwarded" label it would
 * carry. Deleting does need that lock, so the sync is paused for the few
 * seconds it takes.
 */
export async function POST(request: NextRequest) {
  const { ctx, response } = await resolveMessagingRequest(request, 'whatsapp');
  if (response || !ctx) return response;
  if (!ctx.account) {
    return NextResponse.json({ error: 'Link your account first.' }, { status: 409 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  const action = String(body.action ?? '') as Action;
  const chatId = String(body.chatId ?? '').trim();
  const messageId = String(body.messageId ?? '').trim();
  if (!ACTIONS.includes(action)) return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  if (!chatId || !messageId) {
    return NextResponse.json({ error: 'A chat id and message id are required.' }, { status: 400 });
  }

  const account = ctx.account;
  const message = await getMessage(account.id, chatId, messageId);
  if (!message) return NextResponse.json({ error: 'That message is not in this chat.' }, { status: 404 });
  if (message.revoked) {
    return NextResponse.json({ error: 'That message was deleted.' }, { status: 409 });
  }

  switch (action) {
    case 'react': {
      const emoji = String(body.emoji ?? '');
      if (emoji !== '' && !isReactionEmoji(emoji)) {
        return NextResponse.json({ error: 'Unknown reaction.' }, { status: 400 });
      }
      // A group reaction names the message's author; ours, for our own message.
      let sender: string | null = null;
      if (chatId.endsWith('@g.us')) {
        sender = message.fromMe
          ? await linkedJid(account.handle)
          : (message.senderJid ?? (await getMessageSender(account.handle, chatId, messageId)));
        if (!sender) {
          return NextResponse.json({ error: "Can't tell who sent that message, so it can't be reacted to." }, { status: 409 });
        }
      }
      const result = await sendReaction(account.handle, chatId, messageId, emoji, sender);
      if (!result.ok) return NextResponse.json({ error: result.error ?? 'Reaction failed.' }, { status: 502 });
      await applyReactions(account.id, account.userId, [
        {
          chatId,
          targetId: messageId,
          senderJid: await linkedJid(account.handle),
          senderName: 'You',
          emoji,
          fromMe: true,
          at: new Date(),
        },
      ]);
      return NextResponse.json({ ok: true, message: await getMessage(account.id, chatId, messageId) });
    }

    case 'edit': {
      const text = String(body.text ?? '').trim();
      if (!text) return NextResponse.json({ error: 'The new text is required.' }, { status: 400 });
      if (text.length > MAX_TEXT) return NextResponse.json({ error: 'That message is too long.' }, { status: 400 });
      if (!message.fromMe) return NextResponse.json({ error: 'Only your own messages can be edited.' }, { status: 403 });
      if (message.media) return NextResponse.json({ error: 'Only text messages can be edited.' }, { status: 409 });
      const result = await editMessage(account.handle, chatId, messageId, text);
      if (!result.ok) return NextResponse.json({ error: result.error ?? 'Edit failed.' }, { status: 502 });
      const updated = await applyMessageEdit(account.id, account.userId, chatId, messageId, text);
      return NextResponse.json({ ok: true, message: updated });
    }

    case 'revoke': {
      if (!message.fromMe) return NextResponse.json({ error: 'Only your own messages can be deleted.' }, { status: 403 });
      const result = await revokeMessage(account.handle, chatId, messageId);
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
      const updated = await applyMessageRevoke(account.id, account.userId, chatId, messageId);
      return NextResponse.json({ ok: true, message: updated });
    }

    case 'forward': {
      const to = String(body.to ?? '').trim();
      if (!to) return NextResponse.json({ error: 'Choose a chat to forward to.' }, { status: 400 });
      const target = await getChat(account.id, to);
      if (!target) return NextResponse.json({ error: 'That chat is not one of yours.' }, { status: 404 });
      if (target.kind === 'channel') {
        return NextResponse.json({ error: 'Only a channel’s admins can post to it.' }, { status: 409 });
      }

      if (!message.media) {
        if (!message.text) return NextResponse.json({ error: 'There is nothing to forward.' }, { status: 409 });
        const result = await sendText(account.handle, to, message.text);
        if (!result.ok) return NextResponse.json({ error: result.error ?? 'Forward failed.' }, { status: 502 });
        if (result.messageId) {
          await recordOutgoing(account.id, account.userId, {
            chatId: to,
            messageId: result.messageId,
            text: message.text,
            forwarded: true,
          });
        }
        return NextResponse.json({ ok: true, chatId: to });
      }

      // The attachment: from our cache when we hold it, otherwise from WhatsApp
      // (which stops serving old media after some weeks).
      const ref = message.media.ref;
      const cached = ref ? await readCache(account.id, chatId, ref) : null;
      const file = cached ?? (ref ? await getMedia(account.handle, chatId, ref) : null);
      if (!file) {
        return NextResponse.json({ error: 'That attachment is no longer available to forward.' }, { status: 502 });
      }
      const fileName = file.fileName || message.media.fileName || 'attachment';
      const result = await sendMedia(
        account.handle,
        to,
        { bytes: file.bytes, mimeType: file.mimeType, fileName },
        message.text,
      );
      if (!result.ok) return NextResponse.json({ error: result.error ?? 'Forward failed.' }, { status: 502 });
      if (result.messageId) {
        await writeCache(account.id, to, result.messageId, { bytes: file.bytes, mimeType: file.mimeType, fileName });
        await recordOutgoing(account.id, account.userId, {
          chatId: to,
          messageId: result.messageId,
          text: message.text,
          media: {
            kind: message.media.kind === 'sticker' ? 'sticker' : mediaKindFromMime(file.mimeType),
            ref: result.messageId,
            mimeType: file.mimeType,
            fileName,
            sizeBytes: file.bytes.length,
          },
          forwarded: true,
        });
      }
      return NextResponse.json({ ok: true, chatId: to });
    }
  }
}
