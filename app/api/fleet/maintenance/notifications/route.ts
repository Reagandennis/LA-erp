import { NextRequest, NextResponse } from 'next/server';

import { API_ACCESS } from '@/lib/api-access';
import {
  listMaintenanceNotifications,
  markMaintenanceNotificationsRead,
  materializeMaintenanceReminders,
} from '@/lib/fleet-reminders';
import { requireModuleRequest } from '@/lib/request-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.fleetMaintenance);
  if (response || !auth) return response;

  await materializeMaintenanceReminders(auth.user.id);
  return NextResponse.json({ notifications: await listMaintenanceNotifications(auth.user.id) });
}

export async function PATCH(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.fleetMaintenance);
  if (response || !auth) return response;

  const body = await request.json().catch(() => null);
  const ids = Array.isArray(body?.ids) ? (body.ids as unknown[]).map(Number) : [];
  return NextResponse.json({ updated: await markMaintenanceNotificationsRead(auth.user.id, ids) });
}
