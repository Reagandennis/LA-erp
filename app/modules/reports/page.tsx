import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { getRates } from '@/lib/exchange-rates-server';
import { getOrganizationSettings } from '@/lib/organization';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { getReportData } from '@/lib/reports';
import { userHasModule, userHasRole } from '@/lib/user';

import { parseReportCurrency } from './report-currency';
import ReportsClient from './reports-client';

export const dynamic = 'force-dynamic';

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const auth = await getServerAuth();
  if (!auth) redirect('/auth/login');

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  if (!isAdmin && !userHasModule(auth.user, 'reports')) {
    redirect('/dashboard');
  }

  const [organization, rates, { currency: requested }] = await Promise.all([
    getOrganizationSettings(),
    getRates(),
    searchParams,
  ]);
  // With no rate table at all (first fetch failed), stay in the organisation's
  // own currency so most figures still show; the page says what was left out.
  const currency = rates ? parseReportCurrency(requested) : organization.defaultCurrency;
  const data = await getReportData({ userId: auth.user.id, currency, rates });

  return <ReportsClient data={data} currency={currency} />;
}
