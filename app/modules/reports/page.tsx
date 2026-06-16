import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { getOrganizationSettings } from '@/lib/organization';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { getReportData } from '@/lib/reports';
import { userHasModule, userHasRole } from '@/lib/user';

import ReportsClient from './reports-client';

export const dynamic = 'force-dynamic';

export default async function ReportsPage() {
  const auth = await getServerAuth();
  if (!auth) redirect('/auth/login');

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  if (!isAdmin && !userHasModule(auth.user, 'reports')) {
    redirect('/dashboard');
  }

  const organization = await getOrganizationSettings();
  const data = await getReportData({ userId: auth.user.id, currency: organization.defaultCurrency });

  return <ReportsClient data={data} currency={organization.defaultCurrency} />;
}
