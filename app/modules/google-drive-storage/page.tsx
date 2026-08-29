import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasModule, userHasRole } from '@/lib/user';

import DriveClient from './drive-client';

export const dynamic = 'force-dynamic';

export default async function GoogleDriveStoragePage() {
  const auth = await getServerAuth();
  if (!auth) redirect('/auth/login');

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  if (!isAdmin && !userHasModule(auth.user, 'google-drive-storage')) {
    redirect('/dashboard');
  }

  return <DriveClient />;
}
