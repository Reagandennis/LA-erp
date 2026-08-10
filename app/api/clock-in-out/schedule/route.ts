import { NextRequest, NextResponse } from 'next/server';

import { requireAdminRequest, requireRequestAuth } from '@/lib/request-auth';
import {
  createShift,
  deleteShiftById,
  listShifts,
  updateShift,
  type ShiftBlock,
} from '@/lib/schedule';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Read the shared roster (any authenticated user).
export async function GET(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const from = request.nextUrl.searchParams.get('from') ?? undefined;
  const to = request.nextUrl.searchParams.get('to') ?? undefined;
  const shifts = await listShifts(from, to);
  return NextResponse.json({ shifts });
}

// Create a new shift (admin only).
export async function POST(request: NextRequest) {
  const { auth, response } = await requireAdminRequest(request);
  if (response || !auth) return response;

  const body = await request.json().catch(() => null);
  const employeeId = Number(body?.employeeId);
  const date = typeof body?.date === 'string' ? body.date : '';
  const block = body?.block as ShiftBlock | undefined;
  if (!Number.isInteger(employeeId) || employeeId <= 0 || !date || !block || typeof block.type !== 'string') {
    return NextResponse.json({ error: 'employeeId, date and block are required' }, { status: 400 });
  }

  try {
    const shift = await createShift({ adminId: auth.user.id, employeeId, date, block });
    return NextResponse.json({ shift }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not save shift';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

// Update an existing shift by id (admin only).
export async function PUT(request: NextRequest) {
  const { auth, response } = await requireAdminRequest(request);
  if (response || !auth) return response;

  const body = await request.json().catch(() => null);
  const id = Number(body?.id);
  const block = body?.block as ShiftBlock | undefined;
  if (!Number.isInteger(id) || id <= 0 || !block || typeof block.type !== 'string') {
    return NextResponse.json({ error: 'id and block are required' }, { status: 400 });
  }

  try {
    const shift = await updateShift({ adminId: auth.user.id, id, block });
    if (!shift) return NextResponse.json({ error: 'Shift not found' }, { status: 404 });
    return NextResponse.json({ shift });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not save shift';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

// Delete a single shift by id (admin only).
export async function DELETE(request: NextRequest) {
  const { auth, response } = await requireAdminRequest(request);
  if (response || !auth) return response;

  const body = await request.json().catch(() => null);
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  await deleteShiftById(id);
  return NextResponse.json({ deleted: true });
}
