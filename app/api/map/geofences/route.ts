import { NextRequest, NextResponse } from 'next/server';

import type { GeofenceGeometry } from '@/lib/geo-geometry';
import { createGeofence, getMapWorkspace } from '@/lib/map-store';
import { requireModuleRequest } from '@/lib/request-auth';
import { mapGeofenceCreateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, 'map');
  if (response || !auth) return response;

  const { geofences } = await getMapWorkspace();
  return NextResponse.json({ items: geofences });
}

export async function POST(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, 'map');
  if (response || !auth) return response;

  const parsed = mapGeofenceCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid zone' }, { status: 400 });
  }

  const item = await createGeofence(
    { ...parsed.data, geometry: parsed.data.geometry as unknown as GeofenceGeometry },
    auth.user.id,
  );
  return NextResponse.json({ item }, { status: 201 });
}
