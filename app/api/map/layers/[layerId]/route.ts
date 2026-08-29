import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { deleteLayer, updateLayer } from '@/lib/map-store';
import { requireModuleRequest } from '@/lib/request-auth';
import { mapLayerUpdateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ layerId: string }> },
) {
  const { auth, response } = await requireModuleRequest(request, 'map');
  if (response || !auth) return response;

  const id = Number((await params).layerId);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'Invalid layer' }, { status: 400 });

  const parsed = mapLayerUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid layer' }, { status: 400 });
  }

  const item = await updateLayer(id, parsed.data);
  if (!item) return NextResponse.json({ error: 'Layer not found' }, { status: 404 });
  return NextResponse.json({ item });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ layerId: string }> },
) {
  const { auth, response } = await requireModuleRequest(request, 'map');
  if (response || !auth) return response;

  const id = Number((await params).layerId);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'Invalid layer' }, { status: 400 });

  try {
    const deleted = await deleteLayer(id);
    if (!deleted) return NextResponse.json({ error: 'Layer not found' }, { status: 404 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not delete the layer' },
      { status: 400 },
    );
  }

  // Deleting a layer removes its features for everyone — worth an audit trail.
  await recordAuditEvent({
    action: 'map.layer.deleted',
    entityType: 'MapLayer',
    entityId: String(id),
    actorUserId: auth.user.id,
    request,
  });
  return NextResponse.json({ deleted: true });
}
