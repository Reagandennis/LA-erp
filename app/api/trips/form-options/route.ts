import { NextRequest, NextResponse } from 'next/server';

import { API_ACCESS } from '@/lib/api-access';
import { listCustomers } from '@/lib/customers';
import { requireModuleRequest } from '@/lib/request-auth';
import { suggestClientCode } from '@/lib/trip-reference';
import { listOwnerCandidates, listReferenceDefaults, listTravelerOptions, peekNextReferenceNumber } from '@/lib/trips';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * What the trip form picks from: clients, owners, and every client's
 * travellers (names only). Fetched when a trip is opened for editing, so the
 * itinerary page doesn't carry them on every visit. Each client comes with
 * the code and country their trip references usually carry, and the number
 * the next reference will end with, so the form can show it as it fills in.
 */
export async function GET(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.trips);
  if (response || !auth) return response;

  const [customers, owners, travelers, referenceDefaults, nextReferenceNumber] = await Promise.all([
    listCustomers(),
    listOwnerCandidates(auth.user.id),
    listTravelerOptions(),
    listReferenceDefaults(),
    peekNextReferenceNumber(),
  ]);

  return NextResponse.json({
    customers: customers.map((c) => {
      const usual = referenceDefaults.get(c.id);
      return {
        id: c.id,
        name: c.name,
        company: c.company,
        email: c.email,
        referenceCode: usual?.clientCode ?? suggestClientCode(c.company || c.name),
        usualCountry: usual?.country ?? null,
      };
    }),
    owners,
    travelers,
    nextReferenceNumber,
  });
}
