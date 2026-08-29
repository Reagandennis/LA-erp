import { NextRequest, NextResponse } from 'next/server';

import { counts } from '@/lib/messaging-repo';
import { resolveMessagingRequest } from '@/lib/messaging-routes';
import { getStatus } from '@/lib/telegram';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { ctx, response } = await resolveMessagingRequest(request, 'telegram');
  if (response || !ctx) return response;
  const status = await getStatus(ctx.userId);
  // Counts come from the mirror so the header matches what the console shows.
  if (ctx.account) status.counts = await counts(ctx.account.id);
  return NextResponse.json(status);
}
