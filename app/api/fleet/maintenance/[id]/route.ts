import { NextRequest, NextResponse } from 'next/server';

import { API_ACCESS } from '@/lib/api-access';
import { deleteMaintenance, updateMaintenance } from '@/lib/fleet-server';
import { requireModuleRequest } from '@/lib/request-auth';
import { maintenanceUpdateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseId(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.fleetMaintenance);
  if (response || !auth) return response;

  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid maintenance id' }, { status: 400 });

  const body = await request.json().catch(() => null);
  const validation = maintenanceUpdateSchema.safeParse(body ?? {});
  if (!validation.success) {
    return NextResponse.json({ error: validation.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  const result = await updateMaintenance(id, validation.data);
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ item: result.item });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.fleetMaintenance);
  if (response || !auth) return response;

  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid maintenance id' }, { status: 400 });

  if (!(await deleteMaintenance(id))) return NextResponse.json({ error: 'Maintenance record not found' }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
