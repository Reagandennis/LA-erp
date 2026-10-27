import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { localDateKey } from '@/lib/fleet';
import { listFleetVehicles, listFuelLogs } from '@/lib/fleet-server';
import { getOrganizationSettings } from '@/lib/organization';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasModule, userHasRole } from '@/lib/user';

import FuelClient from './fuel-client';

export const dynamic = 'force-dynamic';

export default async function CarFuelPage() {
  const auth = await getServerAuth();
  if (!auth) {
    redirect('/auth/login');
  }

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  if (!isAdmin && !userHasModule(auth.user, 'car-fuel')) {
    redirect('/dashboard');
  }

  const [logs, vehicles, organization] = await Promise.all([
    listFuelLogs(),
    listFleetVehicles(),
    getOrganizationSettings(),
  ]);

  return (
    <FuelClient
      initialLogs={logs}
      vehicles={vehicles}
      defaultCurrency={organization.defaultCurrency}
      // The server's TZ is the business's (see .env.example), so "today" is decided here.
      today={localDateKey()}
    />
  );
}
