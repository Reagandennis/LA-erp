import { NextRequest, NextResponse } from 'next/server';

import { accountGroupSharing, setAccountGroupShare } from '@/lib/messaging-accounts';
import { resolveMessagingRequest } from '@/lib/messaging-routes';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

/**
 * Sharing a WhatsApp number with a group (`?account=<id>`): its owner's
 * groups and which of them can read and reply from it. Owner only.
 */
export async function GET(request: NextRequest) {
  const { ctx, response } = await resolveMessagingRequest(request, 'whatsapp');
  if (response || !ctx) return response;
  if (!ctx.account || ctx.account.shared) return NextResponse.json({ owner: false, groups: [], sharedGroupIds: [] });
  return NextResponse.json({ owner: true, ...(await accountGroupSharing(ctx.userId, ctx.account.id)) });
}

/** `{ groupId, shared }`: share the number with one of the owner's groups, or stop. */
export async function POST(request: NextRequest) {
  const { ctx, response } = await resolveMessagingRequest(request, 'whatsapp');
  if (response || !ctx) return response;
  if (!ctx.account || ctx.account.shared) {
    return NextResponse.json({ error: 'Only the person who linked this number can share it.' }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as { groupId?: unknown; shared?: unknown } | null;
  const groupId = Number(body?.groupId);
  if (!Number.isInteger(groupId) || groupId <= 0 || typeof body?.shared !== 'boolean') {
    return NextResponse.json({ error: 'Pick a group.' }, { status: 400 });
  }
  const ok = await setAccountGroupShare(ctx.userId, ctx.account.id, groupId, body.shared);
  if (!ok) return NextResponse.json({ error: 'You can only share with a group you belong to.' }, { status: 400 });
  return NextResponse.json({ owner: true, ...(await accountGroupSharing(ctx.userId, ctx.account.id)) });
}
