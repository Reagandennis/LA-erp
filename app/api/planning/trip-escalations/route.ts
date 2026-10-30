import { NextRequest, NextResponse } from 'next/server';

import { requireRequestAuth } from '@/lib/request-auth';
import { listTripEscalationNotifications, markTripEscalationNotificationsRead } from '@/lib/trip-escalations';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** The bell's escalation notifications: listed by the feed, marked read here. */
export async function GET(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;
  return NextResponse.json({ notifications: await listTripEscalationNotifications(auth.user.id) });
}

export async function PATCH(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const body = await request.json().catch(() => null);
  const ids = Array.isArray(body?.ids) ? (body.ids as unknown[]).map(Number) : [];
  return NextResponse.json({ updated: await markTripEscalationNotificationsRead(auth.user.id, ids) });
}
