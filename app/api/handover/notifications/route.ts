import { NextRequest, NextResponse } from 'next/server';

import { listHandoverNotifications, markHandoverNotificationsRead } from '@/lib/handover-notifications';
import { requireRequestAuth } from '@/lib/request-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** The bell's handover notifications: listed by the feed, marked read here. Only ever the caller's own. */
export async function GET(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;
  return NextResponse.json({ notifications: await listHandoverNotifications(auth.user.id) });
}

export async function PATCH(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const body = await request.json().catch(() => null);
  const ids = Array.isArray(body?.ids) ? (body.ids as unknown[]).map(Number) : [];
  return NextResponse.json({ updated: await markHandoverNotificationsRead(auth.user.id, ids) });
}
