import { NextRequest, NextResponse } from 'next/server';

import { PEOPLE_MODULE_SLUGS } from '@/lib/people-views';
import { deletePersonnel, getPersonnelById, updatePersonnel } from '@/lib/personnel';
import { requireAdminRequest, requireModuleRequest } from '@/lib/request-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseId(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** The full record for the detail drawer; the list carries only what its cards show. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, response } = await requireModuleRequest(request, ...PEOPLE_MODULE_SLUGS);
  if (response || !auth) return response;

  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid personnel id' }, { status: 400 });

  const item = await getPersonnelById(id);
  if (!item) return NextResponse.json({ error: 'Personnel not found' }, { status: 404 });
  return NextResponse.json({ item });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, response } = await requireAdminRequest(request);
  if (response || !auth) return response;

  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid personnel id' }, { status: 400 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const patch: {
    userId?: number | null;
    name?: string;
    email?: string | null;
    phone?: string | null;
    role?: string | null;
    department?: string;
    status?: string;
    location?: string | null;
    manager?: string | null;
    joinDate?: string | null;
    skills?: unknown;
    roles?: unknown;
    engagement?: string;
    supplierName?: string | null;
    callSign?: string | null;
    grade?: string | null;
    notes?: string | null;
  } = {};
  if (typeof body.name === 'string') patch.name = body.name;
  if (typeof body.email === 'string' || body.email === null) patch.email = body.email;
  if (typeof body.phone === 'string' || body.phone === null) patch.phone = body.phone;
  if (typeof body.role === 'string' || body.role === null) patch.role = body.role;
  if (typeof body.department === 'string') patch.department = body.department;
  if (typeof body.status === 'string') patch.status = body.status;
  if (typeof body.location === 'string' || body.location === null) patch.location = body.location;
  if (typeof body.manager === 'string' || body.manager === null) patch.manager = body.manager;
  if (typeof body.joinDate === 'string' || body.joinDate === null) patch.joinDate = body.joinDate;
  if (Array.isArray(body.skills)) patch.skills = body.skills;
  if (Array.isArray(body.roles)) patch.roles = body.roles;
  if (typeof body.engagement === 'string') patch.engagement = body.engagement;
  if (typeof body.supplierName === 'string' || body.supplierName === null) patch.supplierName = body.supplierName;
  if (typeof body.callSign === 'string' || body.callSign === null) patch.callSign = body.callSign;
  if (typeof body.grade === 'string' || body.grade === null) patch.grade = body.grade;
  if (typeof body.notes === 'string' || body.notes === null) patch.notes = body.notes;
  if (typeof body.userId === 'number' || body.userId === null) patch.userId = body.userId;

  try {
    const item = await updatePersonnel(id, patch);
    if (item === null) return NextResponse.json({ error: 'Personnel not found' }, { status: 404 });
    return NextResponse.json({ item });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not update personnel';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, response } = await requireAdminRequest(request);
  if (response || !auth) return response;

  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid personnel id' }, { status: 400 });

  const ok = await deletePersonnel(id);
  if (!ok) return NextResponse.json({ error: 'Personnel not found' }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
