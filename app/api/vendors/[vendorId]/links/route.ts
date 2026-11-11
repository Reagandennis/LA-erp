import { NextRequest, NextResponse } from 'next/server';

import { API_ACCESS } from '@/lib/api-access';
import { recordAuditEvent } from '@/lib/audit';
import { requireModuleRequest } from '@/lib/request-auth';
import { vendorLinksSchema } from '@/lib/validation';
import { changeVendorPeople, changeVendorServices, changeVendorVehicles } from '@/lib/vendors';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const CHANGE = {
  services: changeVendorServices,
  vehicles: changeVendorVehicles,
  people: changeVendorPeople,
} as const;

/**
 * Adds to, and removes from, what a vendor has: the services in its catalog,
 * the fleet vehicles tagged to it, or the people who work under it.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ vendorId: string }> }) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.vendors);
  if (response || !auth) return response;

  const id = Number((await params).vendorId);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Invalid vendor id' }, { status: 400 });

  const body = await request.json().catch(() => null);
  const validation = vendorLinksSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json({ error: validation.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  const { kind, add, remove } = validation.data;
  const result = await CHANGE[kind](id, { add, remove });
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });

  await recordAuditEvent({
    action: `vendor.${kind}.changed`,
    entityType: 'vendor',
    entityId: String(id),
    actorUserId: auth.user.id,
    metadata: { name: result.vendor?.name, added: add.length, removed: remove.length },
    request,
  });

  return NextResponse.json(result);
}
