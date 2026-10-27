import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { localDateKey } from '@/lib/fleet';
import { listFleetVehicles, listMaintenance, listVehicleOdometers } from '@/lib/fleet-server';
import { getOrganizationSettings } from '@/lib/organization';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasModule, userHasRole } from '@/lib/user';

import MaintenanceClient from './maintenance-client';

export const dynamic = 'force-dynamic';

export default async function CarMaintenancePage() {
  const auth = await getServerAuth();
  if (!auth) {
    redirect('/auth/login');
  }

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  if (!isAdmin && !userHasModule(auth.user, 'car-maintenance')) {
    redirect('/dashboard');
  }

  const [items, vehicles, odometers, organization] = await Promise.all([
    listMaintenance(),
    listFleetVehicles(),
    listVehicleOdometers(),
    getOrganizationSettings(),
  ]);

  return (
    <MaintenanceClient
      initialItems={items}
      vehicles={vehicles}
      odometers={odometers}
      defaultCurrency={organization.defaultCurrency}
      // The server's TZ is the business's (see .env.example), so "today" is decided here.
      today={localDateKey()}
    />
  );
}
