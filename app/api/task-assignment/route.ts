import { NextRequest, NextResponse } from 'next/server';

import { API_ACCESS } from '@/lib/api-access';
import { requireModuleRequest } from '@/lib/request-auth';
import {
  computeStats,
  countPastAssignments,
  listCurrentAssignments,
  listDrivers,
  listEngagements,
  listOfficers,
  listTripOptions,
  listVehicles,
} from '@/lib/task-assignment';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.vehicles);
  if (response || !auth) return response;

  // Current assignments travel with the screen; the history is searched on demand.
  const [vehicles, drivers, officers, assignments, pastAssignments, trips, engagements] = await Promise.all([
    listVehicles(),
    listDrivers(),
    listOfficers(),
    listCurrentAssignments(),
    countPastAssignments(),
    listTripOptions(),
    listEngagements(),
  ]);

  return NextResponse.json({
    vehicles,
    drivers,
    officers,
    assignments,
    pastAssignments,
    trips,
    engagements,
    stats: computeStats({ trips, assignments, pastAssignments, vehicles, drivers, officers }),
  });
}
