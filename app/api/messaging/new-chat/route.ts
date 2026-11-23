import { NextRequest, NextResponse } from 'next/server';

import { isMessagingProvider } from '@/lib/messaging-accounts';
import { resolveNewChatTarget } from '@/lib/messaging-new-chat';
import { resolveMessagingRequest } from '@/lib/messaging-routes';
import { upsertChats } from '@/lib/messaging-repo';
import { checkNumbers } from '@/lib/wacli';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

/**
 * Start a conversation with someone who isn't in the mirror yet.
 *
 * This only creates the local chat row so the console can open an empty thread
 * — nothing is sent until the user actually types. The provider creates the
 * real conversation on first delivery, and its echo replaces this placeholder
 * with the true name.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const provider = String(body?.provider ?? '').trim();
  if (!isMessagingProvider(provider)) {
    return NextResponse.json({ error: 'Unknown provider.' }, { status: 400 });
  }

  const { ctx, response } = await resolveMessagingRequest(request, provider);
  if (response || !ctx) return response;
  if (!ctx.account) {
    return NextResponse.json({ error: 'Link your account first.' }, { status: 409 });
  }

  const resolved = resolveNewChatTarget(provider, String(body?.target ?? ''));
  if ('error' in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: 400 });
  }

  // A WhatsApp chat with a number that has no account would sit in the list
  // forever and every message to it would silently go nowhere, so ask
  // WhatsApp first. The check is live and can fail (sync not up, no network);
  // then the chat is created as before rather than blocking the person.
  if (provider === 'whatsapp') {
    const number = resolved.chatId.split('@')[0] ?? '';
    const check = await checkNumbers(ctx.account.handle, [`+${number}`]);
    const verdict = check.ok ? check.results.find((r) => r.phone === number || r.query === `+${number}`) : null;
    if (verdict?.responded && !verdict.registered) {
      return NextResponse.json({ error: `+${number} is not on WhatsApp.` }, { status: 404 });
    }
  }

  await upsertChats(ctx.account.id, [
    { chatId: resolved.chatId, name: resolved.name, kind: 'dm', lastMessageAt: new Date() },
  ]);

  return NextResponse.json({ ok: true, chatId: resolved.chatId, name: resolved.name });
}
