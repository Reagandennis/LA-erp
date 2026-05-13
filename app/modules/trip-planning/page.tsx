import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { listCustomers } from '@/lib/customers';
import { listOwnerCandidates, listTripsForUser } from '@/lib/trips';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasModule, userHasRole } from '@/lib/user';

import TripsClient from './trips-client';

export const dynamic = 'force-dynamic';

export default async function TripPlanningPage() {
  const auth = await getServerAuth();
  if (!auth) {
    redirect('/auth/login');
  }

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  if (!isAdmin && !userHasModule(auth.user, 'trip-planning')) {
    redirect('/dashboard');
  }

  const [trips, customers, owners] = await Promise.all([
    listTripsForUser({ userId: auth.user.id, isAdmin }),
    listCustomers(),
    listOwnerCandidates(auth.user.id),
  ]);

  return (
    <TripsClient
      currentUser={{ id: auth.user.id, name: auth.user.name, email: auth.user.email }}
      isAdmin={isAdmin}
      initialTrips={trips}
      initialCustomers={customers.map((c) => ({
        id: c.id,
        name: c.name,
        company: c.company,
        email: c.email,
      }))}
      initialOwners={owners}
    />
  );
}
