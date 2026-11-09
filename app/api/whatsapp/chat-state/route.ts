import { NextRequest, NextResponse } from 'next/server';

import { setChatState as mirrorChatState } from '@/lib/messaging-repo';
import { resolveMessagingRequest } from '@/lib/messaging-routes';
import { MUTED_FOREVER } from '@/lib/messaging-store';
import {
  CHAT_STATE_ACTIONS,
  type ChatStateAction,
  MUTE_DURATIONS,
  type MuteDuration,
  setChatState,
} from '@/lib/wacli';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

/**
 * Archive, pin or mute one of the caller's own chats.
 *
 *   POST { id, action: archive|unarchive|pin|unpin|mute|unmute, duration?: 8h|1w|forever }
 *
 * The change is made on WhatsApp first (so the phone agrees), then written to
 * the mirror so the console shows it at once. Only the actions and durations
 * named above are accepted; nothing from the body reaches wacli verbatim
 * except the chat id, which is passed as an argument, never through a shell.
 */
export async function POST(request: NextRequest) {
  const { ctx, response } = await resolveMessagingRequest(request, 'whatsapp');
  if (response || !ctx) return response;
  if (!ctx.account) {
    return NextResponse.json({ error: 'Link your account first.' }, { status: 409 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  const id = String(body.id ?? '').trim();
  const action = String(body.action ?? '') as ChatStateAction;
  const duration = (body.duration === undefined ? 'forever' : String(body.duration)) as MuteDuration;
  if (!id) return NextResponse.json({ error: 'A chat id is required.' }, { status: 400 });
  if (!CHAT_STATE_ACTIONS.includes(action)) {
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  }
  if (action === 'mute' && !(duration in MUTE_DURATIONS)) {
    return NextResponse.json({ error: 'Unknown mute duration.' }, { status: 400 });
  }

  const result = await setChatState(ctx.account.handle, id, action, duration);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  const chat = await mirrorChatState(ctx.account.id, id, patchFor(action, duration), ctx.userId);
  return NextResponse.json({ ok: true, chat });
}

function patchFor(action: ChatStateAction, duration: MuteDuration) {
  switch (action) {
    case 'archive':
      return { archived: true };
    case 'unarchive':
      return { archived: false };
    case 'pin':
      return { pinned: true };
    case 'unpin':
      return { pinned: false };
    case 'mute': {
      const seconds = MUTE_DURATIONS[duration];
      return { mutedUntil: seconds === 0 ? MUTED_FOREVER : new Date(Date.now() + seconds * 1000) };
    }
    case 'unmute':
      return { mutedUntil: null };
  }
}
