import { NextRequest, NextResponse } from 'next/server';

import { requireRequestAuth } from '@/lib/request-auth';
import { deleteOfficer, updateOfficer } from '@/lib/task-assignment';

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
  if (!id) return NextResponse.json({ error: 'Invalid officer id' }, { status: 400 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const patch: { name?: string; callSign?: string | null; grade?: string; phone?: string | null; status?: string; notes?: string | null } = {};
  if (typeof body.name === 'string') patch.name = body.name;
  if (typeof body.callSign === 'string' || body.callSign === null) patch.callSign = body.callSign;
  if (typeof body.grade === 'string') patch.grade = body.grade;
  if (typeof body.phone === 'string' || body.phone === null) patch.phone = body.phone;
  if (typeof body.status === 'string') patch.status = body.status;
  if (typeof body.notes === 'string' || body.notes === null) patch.notes = body.notes;

  const item = await updateOfficer(id, patch);
  if (item === null) return NextResponse.json({ error: 'Officer not found' }, { status: 404 });
  return NextResponse.json({ item });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid officer id' }, { status: 400 });

  const ok = await deleteOfficer(id);
  if (!ok) return NextResponse.json({ error: 'Officer not found' }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
