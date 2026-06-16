import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import {
  computeStats,
  listAssignments,
  listDrivers,
  listOfficers,
  listTripOptions,
  listVehicles,
} from '@/lib/task-assignment';
import { userHasModule, userHasRole } from '@/lib/user';

import TaskAssignmentClient from './task-assignment-client';

export const dynamic = 'force-dynamic';

export default async function TaskAssignmentPage() {
  const auth = await getServerAuth();
  if (!auth) {
    redirect('/auth/login');
  }

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  if (!isAdmin && !userHasModule(auth.user, 'task-assignment')) {
    redirect('/dashboard');
  }

  const [vehicles, drivers, officers, assignments, trips] = await Promise.all([
    listVehicles(),
    listDrivers(),
    listOfficers(),
    listAssignments(),
    listTripOptions(),
  ]);

  return (
    <TaskAssignmentClient
      initialData={{
        vehicles,
        drivers,
        officers,
        assignments,
        trips,
        stats: computeStats({ trips, assignments, vehicles, drivers, officers }),
      }}
    />
  );
}
