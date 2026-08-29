import { NextRequest, NextResponse } from 'next/server';

import { listThread, markRead } from '@/lib/messaging-repo';
import { resolveMessagingRequest } from '@/lib/messaging-routes';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

/**
 * One thread (oldest-first) from the mirror. `before` pages backwards through
 * history so the console can lazy-load older messages instead of everything.
 */
export async function GET(request: NextRequest) {
  const { ctx, response } = await resolveMessagingRequest(request, 'telegram');
  if (response || !ctx) return response;
  if (!ctx.account) return NextResponse.json({ messages: [] });

  const { searchParams } = new URL(request.url);
  const id = (searchParams.get('id') ?? '').trim();
  if (!id) return NextResponse.json({ error: 'A chat id is required.' }, { status: 400 });
  const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 200, 1), 500);
  const beforeRaw = searchParams.get('before');
  const before = beforeRaw ? new Date(beforeRaw) : undefined;

  const messages = await listThread(
    ctx.account.id,
    id,
    limit,
    before && !Number.isNaN(before.getTime()) ? before : undefined,
  );
  // Opening a thread clears its unread badge.
  if (!before) await markRead(ctx.account.id, id);
  return NextResponse.json({ messages });
}
