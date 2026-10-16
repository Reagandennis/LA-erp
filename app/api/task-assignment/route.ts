import { NextRequest, NextResponse } from 'next/server';

import { API_ACCESS } from '@/lib/api-access';
import { requireModuleRequest } from '@/lib/request-auth';
import {
  computeStats,
  listAssignments,
  listDrivers,
  listOfficers,
  listTripOptions,
  listVehicles,
} from '@/lib/task-assignment';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.vehicles);
  if (response || !auth) return response;

  const [vehicles, drivers, officers, assignments, trips] = await Promise.all([
    listVehicles(),
    listDrivers(),
    listOfficers(),
    listAssignments(),
    listTripOptions(),
  ]);

  return NextResponse.json({
    vehicles,
    drivers,
    officers,
    assignments,
    trips,
    stats: computeStats({ trips, assignments, vehicles, drivers, officers }),
  });
}
