import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { listCustomers } from '@/lib/customers';
import { canCloseOutTrips, listCloseoutTrips } from '@/lib/trip-closeout';
import { listOwnerCandidates, listTravelerOptions, listTripsForUser } from '@/lib/trips';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasModule, userHasRole } from '@/lib/user';

import TripsClient from './trips-client';
import type { TripsTab } from './types';

export const dynamic = 'force-dynamic';

export default async function TripPlanningPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const auth = await getServerAuth();
  if (!auth) {
    redirect('/auth/login');
  }

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  const canPlan = isAdmin || userHasModule(auth.user, 'trip-planning');
  // A verifier with only the close-out grant gets the Close out tab alone.
  const canCloseOut = canCloseOutTrips(auth.user);
  if (!canPlan && !canCloseOut) {
    redirect('/dashboard');
  }

  const [trips, customers, owners, travelers, closeoutTrips] = await Promise.all([
    canPlan ? listTripsForUser({ userId: auth.user.id, isAdmin }) : [],
    canPlan ? listCustomers() : [],
    canPlan ? listOwnerCandidates(auth.user.id) : [],
    canPlan ? listTravelerOptions() : [],
    canCloseOut ? listCloseoutTrips(auth.user) : null,
  ]);

  const requestedTab = (await searchParams).tab;
  const initialTab: TripsTab = !canPlan || (canCloseOut && requestedTab === 'close-out') ? 'close-out' : 'trips';

  return (
    <TripsClient
      currentUser={{ id: auth.user.id, name: auth.user.name, email: auth.user.email }}
      canPlan={canPlan}
      initialTab={initialTab}
      initialTrips={trips}
      initialCustomers={customers.map((c) => ({
        id: c.id,
        name: c.name,
        company: c.company,
        email: c.email,
      }))}
      initialOwners={owners}
      initialTravelers={travelers}
      initialCloseoutTrips={closeoutTrips}
    />
  );
}
