import { NextRequest, NextResponse } from 'next/server';

import { canUseFleetMaintenance } from '@/lib/fleet-reminders';
import { loadNotificationFeed } from '@/lib/notification-feed';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireRequestAuth } from '@/lib/request-auth';
import { userHasModule, userHasRole } from '@/lib/user';

/** Aggregated feed for the notifications bell: one request, one auth check. */
export async function GET(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  return NextResponse.json(
    await loadNotificationFeed(auth.user.id, {
      maintenance: canUseFleetMaintenance(auth.user),
      handover: userHasRole(auth.user, ADMIN_ROLE_NAME) || userHasModule(auth.user, 'handover'),
    }),
  );
}
