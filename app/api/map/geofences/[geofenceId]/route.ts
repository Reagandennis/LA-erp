import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import type { GeofenceGeometry } from '@/lib/geo-geometry';
import { deleteGeofence, updateGeofence } from '@/lib/map-store';
import { requireModuleRequest } from '@/lib/request-auth';
import { mapGeofenceUpdateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ geofenceId: string }> },
) {
  const { auth, response } = await requireModuleRequest(request, 'map');
  if (response || !auth) return response;

  const id = Number((await params).geofenceId);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'Invalid zone' }, { status: 400 });

  const parsed = mapGeofenceUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid zone' }, { status: 400 });
  }

  const item = await updateGeofence(id, {
    ...parsed.data,
    geometry: parsed.data.geometry as unknown as GeofenceGeometry | undefined,
  });
  if (!item) return NextResponse.json({ error: 'Zone not found' }, { status: 404 });
  return NextResponse.json({ item });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ geofenceId: string }> },
) {
  const { auth, response } = await requireModuleRequest(request, 'map');
  if (response || !auth) return response;

  const id = Number((await params).geofenceId);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'Invalid zone' }, { status: 400 });

  const deleted = await deleteGeofence(id);
  if (!deleted) return NextResponse.json({ error: 'Zone not found' }, { status: 404 });

  await recordAuditEvent({
    action: 'map.geofence.deleted',
    entityType: 'MapGeofence',
    entityId: String(id),
    actorUserId: auth.user.id,
    request,
  });
  return NextResponse.json({ deleted: true });
}
