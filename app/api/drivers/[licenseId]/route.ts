import { NextRequest, NextResponse } from 'next/server';

import { requireAdminRequest } from '@/lib/request-auth';
import { deleteDriverLicense, updateDriverLicense } from '@/lib/drivers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseId(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ licenseId: string }> },
) {
  // Admin-only, matching POST and DELETE. This previously accepted any
  // authenticated user, so anyone logged in could rewrite any licence's
  // holder, number and expiry date.
  const { auth, response } = await requireAdminRequest(request);
  if (response || !auth) return response;

  const { licenseId: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid license id' }, { status: 400 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const patch: {
    driverName?: string;
    licenseNumber?: string;
    personnelId?: number | null;
    category?: string;
    expiryDate?: Date;
    lastVerified?: Date | null;
    notes?: string | null;
  } = {};

  if (typeof body.driverName === 'string') patch.driverName = body.driverName;
  if (typeof body.licenseNumber === 'string') patch.licenseNumber = body.licenseNumber;
  if (typeof body.personnelId === 'number' || body.personnelId === null) patch.personnelId = body.personnelId;
  if (typeof body.category === 'string') patch.category = body.category;
  if (typeof body.expiryDate === 'string' && body.expiryDate) {
    const d = new Date(body.expiryDate);
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ error: 'Invalid expiry date' }, { status: 400 });
    }
    patch.expiryDate = d;
  }
  if (typeof body.lastVerified === 'string') {
    patch.lastVerified = body.lastVerified ? new Date(body.lastVerified) : null;
  }
  if (typeof body.notes === 'string' || body.notes === null) patch.notes = body.notes;

  const item = await updateDriverLicense(id, patch);
  if (item === null) return NextResponse.json({ error: 'Driver not found' }, { status: 404 });
  return NextResponse.json({ item });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ licenseId: string }> },
) {
  const { auth, response } = await requireAdminRequest(request);
  if (response || !auth) return response;

  const { licenseId: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid license id' }, { status: 400 });

  const ok = await deleteDriverLicense(id);
  if (!ok) return NextResponse.json({ error: 'Driver not found' }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
