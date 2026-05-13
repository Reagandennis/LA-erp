import { NextRequest, NextResponse } from 'next/server';

import { requireRequestAuth } from '@/lib/request-auth';
import {
  listTripNotifications,
  markTripNotificationsRead,
  materializeDueTripReminders,
} from '@/lib/trip-notifications';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  await materializeDueTripReminders(auth.user.id);
  const notifications = await listTripNotifications(auth.user.id);
  return NextResponse.json({ notifications });
}

export async function PATCH(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const body = await request.json().catch(() => null);
  const ids = Array.isArray(body?.ids)
    ? (body.ids as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0)
    : [];

  const updated = await markTripNotificationsRead(auth.user.id, ids);
  return NextResponse.json({ updated });
}
