import { NextRequest, NextResponse } from 'next/server';

import { isMessagingProvider } from '@/lib/messaging-accounts';
import { resolveNewChatTarget } from '@/lib/messaging-new-chat';
import { resolveMessagingRequest } from '@/lib/messaging-routes';
import { upsertChats } from '@/lib/messaging-repo';

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

  await upsertChats(ctx.account.id, [
    { chatId: resolved.chatId, name: resolved.name, kind: 'dm', lastMessageAt: new Date() },
  ]);

  return NextResponse.json({ ok: true, chatId: resolved.chatId, name: resolved.name });
}
