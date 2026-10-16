import { NextRequest, NextResponse } from 'next/server';

import { API_ACCESS } from '@/lib/api-access';
import { requireModuleRequest } from '@/lib/request-auth';
import { deleteAssignment, ResourceConflictError, updateAssignment } from '@/lib/task-assignment';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseId(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function optionalId(value: unknown): number | null {
  if (typeof value !== 'number') return null;
  return Number.isInteger(value) && value > 0 ? value : null;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.taskAssignment);
  if (response || !auth) return response;

  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid assignment id' }, { status: 400 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const patch: { tripId?: number; vehicleId?: number | null; driverId?: number | null; officerId?: number | null; status?: string; notes?: string | null } = {};
  if (body.tripId !== undefined) {
    const t = optionalId(body.tripId);
    if (t) patch.tripId = t;
  }
  if (body.vehicleId !== undefined) patch.vehicleId = optionalId(body.vehicleId);
  if (body.driverId !== undefined) patch.driverId = optionalId(body.driverId);
  if (body.officerId !== undefined) patch.officerId = optionalId(body.officerId);
  if (typeof body.status === 'string') patch.status = body.status;
  if (typeof body.notes === 'string' || body.notes === null) patch.notes = body.notes;

  try {
    const item = await updateAssignment(id, patch);
    if (item === null) return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
    return NextResponse.json({ item });
  } catch (error) {
    if (error instanceof ResourceConflictError) {
      return NextResponse.json({ error: error.message, conflict: true }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : 'Could not update assignment';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.taskAssignment);
  if (response || !auth) return response;

  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid assignment id' }, { status: 400 });

  const ok = await deleteAssignment(id);
  if (!ok) return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
