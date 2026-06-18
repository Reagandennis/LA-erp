import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { listPersonnel, listUserOptions } from '@/lib/personnel';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasModule, userHasRole } from '@/lib/user';

import PersonnelClient from './personnel-client';

export const dynamic = 'force-dynamic';

export default async function PersonnelPage() {
  const auth = await getServerAuth();
  if (!auth) {
    redirect('/auth/login');
  }

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  if (!isAdmin && !userHasModule(auth.user, 'personnel')) {
    redirect('/dashboard');
  }

  const [items, users] = await Promise.all([listPersonnel(), listUserOptions()]);

  return <PersonnelClient isAdmin={isAdmin} initialItems={items} initialUsers={users} />;
}
