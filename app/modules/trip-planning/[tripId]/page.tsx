import { notFound, redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { tripForViewer } from '@/lib/trip-costs';
import { getTripForUser } from '@/lib/trips';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasModule, userHasRole } from '@/lib/user';

import ItineraryPageClient from './itinerary-page-client';

export const dynamic = 'force-dynamic';

export default async function TripItineraryPage({
  params,
}: {
  params: Promise<{ tripId: string }>;
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

  return (
    <ItineraryPageClient
      trip={tripForViewer(trip, auth.user)}
      currentUser={{ id: auth.user.id, name: auth.user.name, email: auth.user.email }}
      isAdmin={isAdmin}
    />
  );
}
