import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { computeStats, listHandovers } from '@/lib/handover';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasModule, userHasRole } from '@/lib/user';

import HandoverClient from './handover-client';

export const dynamic = 'force-dynamic';

export default async function HandoverPage() {
  const auth = await getServerAuth();
  if (!auth) redirect('/auth/login');

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  if (!isAdmin && !userHasModule(auth.user, 'handover')) {
    redirect('/dashboard');
  }

  const handovers = await listHandovers();

  return (
    <HandoverClient
      currentUser={{ id: auth.user.id, name: auth.user.name }}
      isAdmin={isAdmin}
      initialData={{ handovers, stats: computeStats(handovers) }}
    />
  );
}
