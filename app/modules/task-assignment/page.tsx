import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import {
  computeStats,
  countPastAssignments,
  listCurrentAssignments,
  listDrivers,
  listEngagements,
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

  // Current assignments travel with the screen; the history is searched on demand.
  const [vehicles, drivers, officers, assignments, pastAssignments, trips, engagements] = await Promise.all([
    listVehicles(),
    listDrivers(),
    listOfficers(),
    listCurrentAssignments(),
    countPastAssignments(),
    listTripOptions(),
    listEngagements(),
  ]);

  return (
    <TaskAssignmentClient
      initialData={{
        vehicles,
        drivers,
        officers,
        assignments,
        pastAssignments,
        trips,
        engagements,
        stats: computeStats({ trips, assignments, pastAssignments, vehicles, drivers, officers }),
      }}
    />
  );
}
