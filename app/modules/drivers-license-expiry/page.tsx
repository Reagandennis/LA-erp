import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { computeStats, listDriverLicenses } from '@/lib/drivers';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasModule, userHasRole } from '@/lib/user';

import DriversClient from './drivers-client';

export const dynamic = 'force-dynamic';

export default async function DriversLicenseExpiryPage() {
  const auth = await getServerAuth();
  if (!auth) {
    redirect('/auth/login');
  }

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  // This page previously checked only that you were signed in, so every licence
  // in the org was readable by any authenticated user.
  if (!isAdmin && !userHasModule(auth.user, 'drivers-license-expiry')) {
    redirect('/dashboard');
  }

  // Rows deep-link into the Drivers directory, so only offer the link to people
  // who can actually open it.
  const canOpenPersonnel =
    isAdmin || userHasModule(auth.user, 'drivers') || userHasModule(auth.user, 'personnel');

  const items = await listDriverLicenses();

  return (
    <DriversClient
      isAdmin={isAdmin}
      canOpenPersonnel={canOpenPersonnel}
      initialItems={items}
      initialStats={computeStats(items)}
    />
  );
}
