import { redirect } from 'next/navigation';

import { listCustomerAccounts } from '@/lib/accounts';
import { getServerAuth } from '@/lib/auth';
import {
  listContractOptions,
  listCrmActivities,
  listCrmCustomers,
  listDeals,
  listQuoteOptions,
} from '@/lib/crm';
import { getOrganizationSettings } from '@/lib/organization';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasModule, userHasRole } from '@/lib/user';

import CustomersClient from './customers-client';

export const dynamic = 'force-dynamic';

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const auth = await getServerAuth();
  if (!auth) redirect('/auth/login');

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  if (!isAdmin && !userHasModule(auth.user, 'customers')) {
    redirect('/dashboard');
  }

  // Global search deep-links straight onto a customer (`?open=<customerId>`).
  const { open } = await searchParams;
  const openId = Number(Array.isArray(open) ? open[0] : open);

  const organization = await getOrganizationSettings();
  const [accounts, deals, customers, activities, quoteOptions, contractOptions] = await Promise.all([
    listCustomerAccounts(organization.defaultCurrency),
    listDeals(),
    listCrmCustomers(),
    listCrmActivities(),
    listQuoteOptions(),
    listContractOptions(),
  ]);

  return (
    <CustomersClient
      currency={organization.defaultCurrency}
      initialAccounts={accounts}
      initialDeals={deals}
      initialCustomers={customers}
      initialActivities={activities}
      quoteOptions={quoteOptions}
      contractOptions={contractOptions}
      initialOpenId={Number.isInteger(openId) && openId > 0 ? openId : null}
    />
  );
}
