import { notFound, redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { tripForViewer } from '@/lib/trip-costs';
import { listCrewOptions } from '@/lib/trip-crew';
import { getTripForUser, listTravelerOptions } from '@/lib/trips';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasModule, userHasRole } from '@/lib/user';

import ItineraryPageClient from './itinerary-page-client';

export const dynamic = 'force-dynamic';

export default async function TripItineraryPage({
  params,
  searchParams,
}: {
  params: Promise<{ tripId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const auth = await getServerAuth();
  if (!auth) redirect('/auth/login');

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  if (!isAdmin && !userHasModule(auth.user, 'trip-planning')) {
    redirect('/dashboard');
  }

  const { tripId: raw } = await params;
  const tripId = Number(raw);
  if (!Number.isInteger(tripId) || tripId <= 0) notFound();

  const trip = await getTripForUser({ id: tripId, userId: auth.user.id, isAdmin });
  if (!trip) notFound();
  const [crewOptions, clientTravelers] = await Promise.all([
    listCrewOptions(trip.id),
    listTravelerOptions(trip.customer.id),
  ]);

  // `?event=<id>` (from the availability grid and elsewhere) opens the page on that event.
  const { event } = await searchParams;
  const eventId = Number(Array.isArray(event) ? event[0] : event);

  return (
    <ItineraryPageClient
      trip={tripForViewer(trip, auth.user)}
      crewOptions={crewOptions}
      clientTravelers={clientTravelers}
      currentUser={{ id: auth.user.id, name: auth.user.name, email: auth.user.email }}
      isAdmin={isAdmin}
      focusItemId={Number.isInteger(eventId) && eventId > 0 ? eventId : null}
    />
  );
}
