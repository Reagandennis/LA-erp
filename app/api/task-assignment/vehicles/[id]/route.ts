import { NextRequest, NextResponse } from 'next/server';

import { requireRequestAuth } from '@/lib/request-auth';
import { deleteVehicle, updateVehicle } from '@/lib/task-assignment';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseId(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid vehicle id' }, { status: 400 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const patch: { registration?: string; make?: string | null; model?: string | null; type?: string; status?: string; capacity?: number | null; notes?: string | null } = {};
  if (typeof body.registration === 'string') patch.registration = body.registration;
  if (typeof body.make === 'string' || body.make === null) patch.make = body.make;
  if (typeof body.model === 'string' || body.model === null) patch.model = body.model;
  if (typeof body.type === 'string') patch.type = body.type;
  if (typeof body.status === 'string') patch.status = body.status;
  if (typeof body.capacity === 'number' || body.capacity === null) patch.capacity = body.capacity;
  if (typeof body.notes === 'string' || body.notes === null) patch.notes = body.notes;

  const item = await updateVehicle(id, patch);
  if (item === null) return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 });
  return NextResponse.json({ item });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid vehicle id' }, { status: 400 });

  const ok = await deleteVehicle(id);
  if (!ok) return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
