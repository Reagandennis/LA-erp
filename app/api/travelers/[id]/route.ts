import { NextRequest, NextResponse } from 'next/server';

import { requireAdminRequest } from '@/lib/request-auth';
import { deleteTraveler, updateTraveler } from '@/lib/travelers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseId(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, response } = await requireAdminRequest(request);
  if (response || !auth) return response;

  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid traveller id' }, { status: 400 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const patch: {
    name?: string;
    customerId?: number | null;
    email?: string | null;
    phone?: string | null;
    nationality?: string | null;
    dateOfBirth?: string | null;
    passportNumber?: string | null;
    passportExpiry?: string | null;
    status?: string;
    riskLevel?: string;
    dietaryNotes?: string | null;
    medicalNotes?: string | null;
    emergencyContactName?: string | null;
    emergencyContactPhone?: string | null;
    notes?: string | null;
  } = {};
  if (typeof body.name === 'string') patch.name = body.name;
  if (typeof body.customerId === 'number' || body.customerId === null) patch.customerId = body.customerId;
  if (typeof body.email === 'string' || body.email === null) patch.email = body.email;
  if (typeof body.phone === 'string' || body.phone === null) patch.phone = body.phone;
  if (typeof body.nationality === 'string' || body.nationality === null) patch.nationality = body.nationality;
  if (typeof body.dateOfBirth === 'string' || body.dateOfBirth === null) patch.dateOfBirth = body.dateOfBirth;
  if (typeof body.passportNumber === 'string' || body.passportNumber === null) patch.passportNumber = body.passportNumber;
  if (typeof body.passportExpiry === 'string' || body.passportExpiry === null) patch.passportExpiry = body.passportExpiry;
  if (typeof body.status === 'string') patch.status = body.status;
  if (typeof body.riskLevel === 'string') patch.riskLevel = body.riskLevel;
  if (typeof body.dietaryNotes === 'string' || body.dietaryNotes === null) patch.dietaryNotes = body.dietaryNotes;
  if (typeof body.medicalNotes === 'string' || body.medicalNotes === null) patch.medicalNotes = body.medicalNotes;
  if (typeof body.emergencyContactName === 'string' || body.emergencyContactName === null) {
    patch.emergencyContactName = body.emergencyContactName;
  }
  if (typeof body.emergencyContactPhone === 'string' || body.emergencyContactPhone === null) {
    patch.emergencyContactPhone = body.emergencyContactPhone;
  }
  if (typeof body.notes === 'string' || body.notes === null) patch.notes = body.notes;

  try {
    const item = await updateTraveler(id, patch);
    if (item === null) return NextResponse.json({ error: 'Traveller not found' }, { status: 404 });
    return NextResponse.json({ item });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not update the traveller';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, response } = await requireAdminRequest(request);
  if (response || !auth) return response;

  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid traveller id' }, { status: 400 });

  const ok = await deleteTraveler(id);
  if (!ok) return NextResponse.json({ error: 'Traveller not found' }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
