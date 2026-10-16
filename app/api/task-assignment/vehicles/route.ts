import { NextRequest, NextResponse } from 'next/server';

import { API_ACCESS } from '@/lib/api-access';
import { requireModuleRequest } from '@/lib/request-auth';
import { createVehicle } from '@/lib/task-assignment';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.vehicles);
  if (response || !auth) return response;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  try {
    const item = await createVehicle({
      userId: auth.user.id,
      registration: String(body.registration ?? ''),
      make: body.make ?? null,
      model: body.model ?? null,
      type: typeof body.type === 'string' ? body.type : undefined,
      status: typeof body.status === 'string' ? body.status : undefined,
      capacity: typeof body.capacity === 'number' ? body.capacity : null,
      notes: body.notes ?? null,
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not add vehicle';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
