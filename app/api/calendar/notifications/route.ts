import { NextRequest, NextResponse } from 'next/server';

import { requireRequestAuth } from '@/lib/request-auth';
import {
  listCalendarNotifications,
  markCalendarNotificationsRead,
  materializeDueCalendarReminders,
} from '@/lib/calendar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  await materializeDueCalendarReminders(auth.user.id);
  const notifications = await listCalendarNotifications(auth.user.id);
  return NextResponse.json({ notifications });
}

export async function PATCH(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const body = await request.json().catch(() => null);
  const ids = Array.isArray(body?.ids) ? (body.ids as unknown[]) : [];
  const numericIds = ids.map(Number).filter((n: number) => Number.isFinite(n));

  const updated = await markCalendarNotificationsRead(auth.user.id, numericIds);
  return NextResponse.json({ updated });
}
