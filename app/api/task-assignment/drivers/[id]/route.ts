import { NextRequest, NextResponse } from 'next/server';

import { requireRequestAuth } from '@/lib/request-auth';
import { deleteDriver, updateDriver } from '@/lib/task-assignment';

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
  if (!id) return NextResponse.json({ error: 'Invalid driver id' }, { status: 400 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const patch: { name?: string; phone?: string | null; licenseNumber?: string | null; status?: string; notes?: string | null } = {};
  if (typeof body.name === 'string') patch.name = body.name;
  if (typeof body.phone === 'string' || body.phone === null) patch.phone = body.phone;
  if (typeof body.licenseNumber === 'string' || body.licenseNumber === null) patch.licenseNumber = body.licenseNumber;
  if (typeof body.status === 'string') patch.status = body.status;
  if (typeof body.notes === 'string' || body.notes === null) patch.notes = body.notes;

  const item = await updateDriver(id, patch);
  if (item === null) return NextResponse.json({ error: 'Driver not found' }, { status: 404 });
  return NextResponse.json({ item });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid driver id' }, { status: 400 });

  const ok = await deleteDriver(id);
  if (!ok) return NextResponse.json({ error: 'Driver not found' }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
