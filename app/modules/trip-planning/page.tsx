import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { canCloseOutTrips, countPendingCloseouts, listCloseoutTrips } from '@/lib/trip-closeout';
import { countTripsByStatus, searchTrips } from '@/lib/trips';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasModule, userHasRole } from '@/lib/user';

import { parseListQuery } from './list-model';
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

  const params = await searchParams;

  // Legacy ?focus=<tripId> deep links (quote drawer, notifications) go straight
  // to the itinerary page rather than rendering the list first.
  const focus = Number(Array.isArray(params.focus) ? params.focus[0] : params.focus);
  if (canPlan && Number.isInteger(focus) && focus > 0) {
    redirect(`/modules/trip-planning/${focus}`);
  }

  const requestedTab = params.tab;
  const initialTab: TripsTab = !canPlan || (canCloseOut && requestedTab === 'close-out') ? 'close-out' : 'trips';
  // The search, status pill and sort live in the URL, so the first page is
  // the one the viewer asked for (or came back to).
  const initialQuery = parseListQuery(params);

  // The close-out list (every completed trip) is only loaded with the screen
  // when that tab is the one opening; otherwise the tab fetches it on demand
  // and the screen ships just the pending count for its badge.
  const emptyPage = { trips: [], total: 0, page: 1, pageSize: 50 };
  const emptyCounts = { Draft: 0, Planned: 0, Active: 0, Completed: 0, Cancelled: 0, total: 0 };
  // The screen opens on the first page; later pages and new queries come from
  // /api/trips. The New trip form's clients and travellers come from
  // /api/trips/form-options when it opens, so they never travel with the page.
  const [firstPage, counts, closeoutTrips, pendingCloseouts] = await Promise.all([
    canPlan
      ? searchTrips({
          userId: auth.user.id,
          isAdmin,
          page: 1,
          q: initialQuery.q,
          status: initialQuery.status === 'All' ? null : initialQuery.status,
          sort: initialQuery.sort,
        })
      : emptyPage,
    canPlan ? countTripsByStatus(auth.user.id, isAdmin) : emptyCounts,
    canCloseOut && initialTab === 'close-out' ? listCloseoutTrips(auth.user) : null,
    canCloseOut && initialTab !== 'close-out' ? countPendingCloseouts() : 0,
  ]);

  return (
    <TripsClient
      currentUser={{ id: auth.user.id, name: auth.user.name, email: auth.user.email }}
      canPlan={canPlan}
      canCloseOut={canCloseOut}
      initialTab={initialTab}
      initialQuery={initialQuery}
      initialTrips={firstPage.trips}
      initialTotal={firstPage.total}
      initialCounts={counts}
      initialCloseoutTrips={closeoutTrips}
      initialPendingCloseouts={pendingCloseouts}
    />
  );
}
