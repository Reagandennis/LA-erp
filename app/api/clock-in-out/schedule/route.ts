import { NextRequest, NextResponse } from 'next/server';

import { requireAdminRequest, requireRequestAuth } from '@/lib/request-auth';
import { deleteShift, listShifts, upsertShift, type ShiftBlock } from '@/lib/schedule';

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

// Assign / update a shift (admin only).
export async function PUT(request: NextRequest) {
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
    const shift = await upsertShift({ adminId: auth.user.id, employeeId, date, block });
    return NextResponse.json({ shift });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not save shift';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

// Clear a shift (admin only).
export async function DELETE(request: NextRequest) {
  const { auth, response } = await requireAdminRequest(request);
  if (response || !auth) return response;

  const body = await request.json().catch(() => null);
  const employeeId = Number(body?.employeeId);
  const date = typeof body?.date === 'string' ? body.date : '';
  if (!Number.isInteger(employeeId) || employeeId <= 0 || !date) {
    return NextResponse.json({ error: 'employeeId and date are required' }, { status: 400 });
  }

  await deleteShift(employeeId, date);
  return NextResponse.json({ deleted: true });
}
