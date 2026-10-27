import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { loadOpsDashboard, loadOpsReference } from '@/lib/ops-dashboard';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasModule, userHasRole } from '@/lib/user';

import OpsDashboardClient from './ops-dashboard-client';

export const dynamic = 'force-dynamic';

export default async function OpsDashboardPage() {
  const auth = await getServerAuth();
  if (!auth) redirect('/auth/login');

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  if (!isAdmin && !userHasModule(auth.user, 'ops-dashboard')) {
    redirect('/dashboard');
  }

  const [initial, reference] = await Promise.all([loadOpsDashboard(auth.user), loadOpsReference(auth.user)]);
  return <OpsDashboardClient initial={initial} reference={reference} />;
}
