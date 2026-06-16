import { NextRequest, NextResponse } from 'next/server';

import { requireRequestAuth } from '@/lib/request-auth';
import { createAssignment, ResourceConflictError } from '@/lib/task-assignment';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function optionalId(value: unknown): number | null {
  if (typeof value !== 'number') return null;
  return Number.isInteger(value) && value > 0 ? value : null;
}

export async function POST(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const tripId = optionalId(body.tripId);
  if (!tripId) return NextResponse.json({ error: 'A trip is required' }, { status: 400 });

  try {
    const item = await createAssignment({
      userId: auth.user.id,
      tripId,
      vehicleId: optionalId(body.vehicleId),
      driverId: optionalId(body.driverId),
      officerId: optionalId(body.officerId),
      status: typeof body.status === 'string' ? body.status : undefined,
      notes: body.notes ?? null,
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    if (error instanceof ResourceConflictError) {
      return NextResponse.json({ error: error.message, conflict: true }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : 'Could not create assignment';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
