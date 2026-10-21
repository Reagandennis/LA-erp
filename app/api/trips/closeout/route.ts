import { NextRequest, NextResponse } from 'next/server';

import { API_ACCESS } from '@/lib/api-access';
import { requireModuleRequest } from '@/lib/request-auth';
import { listCloseoutTrips } from '@/lib/trip-closeout';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** The Close out tab's list, fetched when the tab is opened rather than with the Trips screen. */
export async function GET(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.tripCloseout);
  if (response || !auth) return response;
  return NextResponse.json({ trips: await listCloseoutTrips(auth.user) });
}
