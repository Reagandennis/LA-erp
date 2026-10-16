import { NextRequest, NextResponse } from 'next/server';

import { deleteContact, updateContact } from '@/lib/contacts';
import { API_ACCESS } from '@/lib/api-access';
import { requireModuleRequest } from '@/lib/request-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseId(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.contacts);
  if (response || !auth) return response;

  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid contact id' }, { status: 400 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const patch: {
    name?: string;
    role?: string | null;
    category?: string;
    email?: string | null;
    phone?: string | null;
    location?: string | null;
    notes?: string | null;
    tags?: unknown;
    customerId?: number | null;
  } = {};
  if (typeof body.name === 'string') patch.name = body.name;
  if (typeof body.role === 'string' || body.role === null) patch.role = body.role;
  if (typeof body.category === 'string') patch.category = body.category;
  if (typeof body.email === 'string' || body.email === null) patch.email = body.email;
  if (typeof body.phone === 'string' || body.phone === null) patch.phone = body.phone;
  if (typeof body.location === 'string' || body.location === null) patch.location = body.location;
  if (typeof body.notes === 'string' || body.notes === null) patch.notes = body.notes;
  if (Array.isArray(body.tags)) patch.tags = body.tags;
  if (typeof body.customerId === 'number' || body.customerId === null) patch.customerId = body.customerId;

  const item = await updateContact(id, patch);
  if (item === null) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
  return NextResponse.json({ item });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.contacts);
  if (response || !auth) return response;

  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid contact id' }, { status: 400 });

  const ok = await deleteContact(id);
  if (!ok) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
