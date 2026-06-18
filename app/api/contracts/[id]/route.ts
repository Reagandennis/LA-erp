import { NextRequest, NextResponse } from 'next/server';

import { deleteContract, updateContract } from '@/lib/contracts';
import { requireAdminRequest, requireRequestAuth } from '@/lib/request-auth';

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
  if (!id) return NextResponse.json({ error: 'Invalid contract id' }, { status: 400 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const patch: {
    reference?: string;
    counterpartyName?: string;
    email?: string | null;
    department?: string | null;
    type?: string;
    status?: string;
    startDate?: Date;
    endDate?: Date;
    value?: number | null;
    currency?: string;
    lastRenewalDate?: Date | null;
    notes?: string | null;
  } = {};

  if (typeof body.reference === 'string') patch.reference = body.reference;
  if (typeof body.counterpartyName === 'string') patch.counterpartyName = body.counterpartyName;
  if (typeof body.email === 'string' || body.email === null) patch.email = body.email;
  if (typeof body.department === 'string' || body.department === null) patch.department = body.department;
  if (typeof body.type === 'string') patch.type = body.type;
  if (typeof body.status === 'string') patch.status = body.status;
  if (typeof body.startDate === 'string' && body.startDate) {
    const d = new Date(body.startDate);
    if (Number.isNaN(d.getTime())) return NextResponse.json({ error: 'Invalid start date' }, { status: 400 });
    patch.startDate = d;
  }
  if (typeof body.endDate === 'string' && body.endDate) {
    const d = new Date(body.endDate);
    if (Number.isNaN(d.getTime())) return NextResponse.json({ error: 'Invalid end date' }, { status: 400 });
    patch.endDate = d;
  }
  if (typeof body.value === 'number' || body.value === null) patch.value = body.value;
  if (typeof body.currency === 'string') patch.currency = body.currency;
  if (typeof body.lastRenewalDate === 'string') {
    patch.lastRenewalDate = body.lastRenewalDate ? new Date(body.lastRenewalDate) : null;
  } else if (body.lastRenewalDate === null) {
    patch.lastRenewalDate = null;
  }
  if (typeof body.notes === 'string' || body.notes === null) patch.notes = body.notes;

  try {
    const item = await updateContract(id, patch);
    if (item === null) return NextResponse.json({ error: 'Contract not found' }, { status: 404 });
    return NextResponse.json({ item });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not update contract';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, response } = await requireAdminRequest(request);
  if (response || !auth) return response;

  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid contract id' }, { status: 400 });

  const ok = await deleteContract(id);
  if (!ok) return NextResponse.json({ error: 'Contract not found' }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
