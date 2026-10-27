import { NextRequest, NextResponse } from 'next/server';

import { API_ACCESS } from '@/lib/api-access';
import { createFuelLog, listFuelLogs } from '@/lib/fleet-server';
import { requireModuleRequest } from '@/lib/request-auth';
import { fuelLogCreateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.fleetFuel);
  if (response || !auth) return response;

  return NextResponse.json({ items: await listFuelLogs() });
}

export async function POST(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.fleetFuel);
  if (response || !auth) return response;

  const body = await request.json().catch(() => null);
  const validation = fuelLogCreateSchema.safeParse(body ?? {});
  if (!validation.success) {
    return NextResponse.json({ error: validation.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  const result = await createFuelLog(auth.user.id, validation.data);
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ item: result.item }, { status: 201 });
}
