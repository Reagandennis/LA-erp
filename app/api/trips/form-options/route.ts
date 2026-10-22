import { NextRequest, NextResponse } from 'next/server';

import { API_ACCESS } from '@/lib/api-access';
import { listCustomers } from '@/lib/customers';
import { requireModuleRequest } from '@/lib/request-auth';
import { listOwnerCandidates, listTravelerOptions } from '@/lib/trips';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * What the trip form picks from: clients, owners, and every client's
 * travellers (names only). Fetched when a trip is opened for editing, so the
 * itinerary page doesn't carry them on every visit.
 */
export async function GET(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.trips);
  if (response || !auth) return response;

  const [customers, owners, travelers] = await Promise.all([
    listCustomers(),
    listOwnerCandidates(auth.user.id),
    listTravelerOptions(),
  ]);

  return NextResponse.json({
    customers: customers.map((c) => ({ id: c.id, name: c.name, company: c.company, email: c.email })),
    owners,
    travelers,
  });
}
