import { NextRequest, NextResponse } from 'next/server';

import { listChats } from '@/lib/messaging-repo';
import { resolveMessagingRequest } from '@/lib/messaging-routes';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

/** Conversations for the caller's own account, straight from the mirror. */
export async function GET(request: NextRequest) {
  const { ctx, response } = await resolveMessagingRequest(request, 'telegram');
  if (response || !ctx) return response;
  if (!ctx.account) return NextResponse.json({ chats: [] });

  const { searchParams } = new URL(request.url);
  const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 500, 1), 2000);
  return NextResponse.json({ chats: await listChats(ctx.account.id, limit) });
}
