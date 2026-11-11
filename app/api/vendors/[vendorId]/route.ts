import { NextRequest, NextResponse } from 'next/server';

import { API_ACCESS } from '@/lib/api-access';
import { recordAuditEvent } from '@/lib/audit';
import { requireModuleRequest } from '@/lib/request-auth';
import { vendorUpdateSchema } from '@/lib/validation';
import { deleteVendor, updateVendor } from '@/lib/vendors';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseId(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ vendorId: string }> }) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.vendors);
  if (response || !auth) return response;

  const id = parseId((await params).vendorId);
  if (!id) return NextResponse.json({ error: 'Invalid vendor id' }, { status: 400 });

  const body = await request.json().catch(() => null);
  const validation = vendorUpdateSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json({ error: validation.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  const result = await updateVendor(id, validation.data);
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });

  await recordAuditEvent({
    action: validation.data.status ? 'vendor.status.changed' : 'vendor.updated',
    entityType: 'vendor',
    entityId: String(id),
    actorUserId: auth.user.id,
    metadata: { name: result.vendor?.name, status: result.vendor?.status, changed: Object.keys(validation.data) },
    request,
  });

  return NextResponse.json(result);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ vendorId: string }> }) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.vendors);
  if (response || !auth) return response;

  const id = parseId((await params).vendorId);
  if (!id) return NextResponse.json({ error: 'Invalid vendor id' }, { status: 400 });

  const result = await deleteVendor(id);
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });

  await recordAuditEvent({
    action: 'vendor.deleted',
    entityType: 'vendor',
    entityId: String(id),
    actorUserId: auth.user.id,
    request,
  });

  return NextResponse.json(result);
}
