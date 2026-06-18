import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { listVehicles } from '@/lib/task-assignment';
import { userHasModule, userHasRole } from '@/lib/user';

import VehiclesClient from './vehicles-client';

export const dynamic = 'force-dynamic';

export default async function VehiclesPage() {
  const auth = await getServerAuth();
  if (!auth) {
    redirect('/auth/login');
  }

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  if (!isAdmin && !userHasModule(auth.user, 'vehicles')) {
    redirect('/dashboard');
  }

  const vehicles = await listVehicles();

  return <VehiclesClient initialVehicles={vehicles} />;
}
