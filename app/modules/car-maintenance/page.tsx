import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { type VehicleTripUse, localDateKey } from '@/lib/fleet';
import { countVehiclesOutsideFleet, listFleetVehicles, listMaintenance, listVehicleOdometers } from '@/lib/fleet-server';
import { getOrganizationSettings } from '@/lib/organization';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { listEngagements } from '@/lib/task-assignment';
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

  // Maintenance is kept for our own fleet: only vehicles marked Internal in the
  // Vehicles module are offered here, and only their records are listed.
  const [items, vehicles, odometers, organization, outsideFleet] = await Promise.all([
    listMaintenance({ internalOnly: true }),
    listFleetVehicles({ internalOnly: true }),
    listVehicleOdometers(),
    getOrganizationSettings(),
    countVehiclesOutsideFleet(),
  ]);

  // Where each of those vehicles is spoken for, so maintenance is planned
  // around trips. Only the trip's reference and days: no travellers, no route.
  const engagements = await listEngagements({ resources: { vehicle: vehicles.map((vehicle) => vehicle.id) } });
  const tripUse: VehicleTripUse[] = engagements
    .filter((engagement) => engagement.kind === 'vehicle')
    .map((engagement) => ({
      vehicleId: engagement.resourceId,
      tripId: engagement.tripId,
      reference: engagement.reference,
      from: engagement.from,
      to: engagement.to,
    }));

  return (
    <MaintenanceClient
      initialItems={items}
      vehicles={vehicles}
      tripUse={tripUse}
      outsideFleet={outsideFleet}
      odometers={odometers}
      defaultCurrency={organization.defaultCurrency}
      // The server's TZ is the business's (see .env.example), so "today" is decided here.
      today={localDateKey()}
    />
  );
}
