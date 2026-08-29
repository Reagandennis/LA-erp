import { NextRequest, NextResponse } from 'next/server';

import type { GeoGeometry } from '@/lib/geo-geometry';
import { deleteFeature, updateFeature } from '@/lib/map-store';
import { requireModuleRequest } from '@/lib/request-auth';
import { mapFeatureUpdateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ featureId: string }> },
) {
  const { auth, response } = await requireModuleRequest(request, 'map');
  if (response || !auth) return response;

  const id = Number((await params).featureId);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'Invalid shape' }, { status: 400 });

  const parsed = mapFeatureUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid shape' }, { status: 400 });
  }

  const item = await updateFeature(id, {
    ...parsed.data,
    geometry: parsed.data.geometry as unknown as GeoGeometry | undefined,
  });
  if (!item) return NextResponse.json({ error: 'Shape not found' }, { status: 404 });
  return NextResponse.json({ item });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ featureId: string }> },
) {
  const { auth, response } = await requireModuleRequest(request, 'map');
  if (response || !auth) return response;

  const id = Number((await params).featureId);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'Invalid shape' }, { status: 400 });

  const deleted = await deleteFeature(id);
  if (!deleted) return NextResponse.json({ error: 'Shape not found' }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
