import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { computeStats, listDriverLicenses } from '@/lib/drivers';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasRole } from '@/lib/user';

import DriversClient from './drivers-client';

export const dynamic = 'force-dynamic';

export default async function DriversLicenseExpiryPage() {
  const auth = await getServerAuth();
  if (!auth) {
    redirect('/auth/login');
  }

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  const items = await listDriverLicenses();

  return <DriversClient isAdmin={isAdmin} initialItems={items} initialStats={computeStats(items)} />;
}
