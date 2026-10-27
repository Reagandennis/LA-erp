import { NextRequest, NextResponse } from 'next/server';

import { canUseFleetMaintenance } from '@/lib/fleet-reminders';
import { loadNotificationFeed } from '@/lib/notification-feed';
import { requireRequestAuth } from '@/lib/request-auth';

/** Aggregated feed for the notifications bell: one request, one auth check. */
export async function GET(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  return NextResponse.json(
    await loadNotificationFeed(auth.user.id, { maintenance: canUseFleetMaintenance(auth.user) }),
  );
}
