import { NextRequest, NextResponse } from 'next/server';

import { counts } from '@/lib/messaging-repo';
import { resolveMessagingRequest } from '@/lib/messaging-routes';
import { getStatus } from '@/lib/signal-cli';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { ctx, response } = await resolveMessagingRequest(request, 'signal');
  if (response || !ctx) return response;
  const status = await getStatus(ctx.account?.handle ?? null);
  // Counts come from the mirror so the header matches what the console shows.
  if (ctx.account) status.counts = await counts(ctx.account.id);
  // The account id lets the page tell alerts which chat is already on screen.
  return NextResponse.json({ ...status, accountId: ctx.account?.id ?? null });
}
