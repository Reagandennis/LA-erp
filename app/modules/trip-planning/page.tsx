import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { listCustomers } from '@/lib/customers';
import { canCloseOutTrips, countPendingCloseouts, listCloseoutTrips } from '@/lib/trip-closeout';
import { countTripsByStatus, listOwnerCandidates, listTravelerOptions, searchTrips } from '@/lib/trips';
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

  const requestedTab = (await searchParams).tab;
  const initialTab: TripsTab = !canPlan || (canCloseOut && requestedTab === 'close-out') ? 'close-out' : 'trips';

  // The close-out list (every completed trip) is only loaded with the screen
  // when that tab is the one opening; otherwise the tab fetches it on demand
  // and the screen ships just the pending count for its badge.
  const emptyPage = { trips: [], total: 0, page: 1, pageSize: 50 };
  const emptyCounts = { Draft: 0, Planned: 0, Active: 0, Completed: 0, Cancelled: 0, total: 0 };
  // The screen opens on the first page; search, filters and later pages come
  // from /api/trips so the history never has to travel with the page.
  const [firstPage, counts, customers, owners, travelers, closeoutTrips, pendingCloseouts] = await Promise.all([
    canPlan ? searchTrips({ userId: auth.user.id, isAdmin, page: 1 }) : emptyPage,
    canPlan ? countTripsByStatus(auth.user.id, isAdmin) : emptyCounts,
    canPlan ? listCustomers() : [],
    canPlan ? listOwnerCandidates(auth.user.id) : [],
    canPlan ? listTravelerOptions() : [],
    canCloseOut && initialTab === 'close-out' ? listCloseoutTrips(auth.user) : null,
    canCloseOut && initialTab !== 'close-out' ? countPendingCloseouts() : 0,
  ]);

  return (
    <TripsClient
      currentUser={{ id: auth.user.id, name: auth.user.name, email: auth.user.email }}
      canPlan={canPlan}
      canCloseOut={canCloseOut}
      initialTab={initialTab}
      initialTrips={firstPage.trips}
      initialTotal={firstPage.total}
      initialPageSize={firstPage.pageSize}
      initialCounts={counts}
      initialCustomers={customers.map((c) => ({
        id: c.id,
        name: c.name,
        company: c.company,
        email: c.email,
      }))}
      initialOwners={owners}
      initialTravelers={travelers}
      initialCloseoutTrips={closeoutTrips}
      initialPendingCloseouts={pendingCloseouts}
    />
  );
}
