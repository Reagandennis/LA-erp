import { redirect } from 'next/navigation';

import { listCustomerAccounts } from '@/lib/accounts';
import { getServerAuth } from '@/lib/auth';
import { getOrganizationSettings } from '@/lib/organization';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasModule, userHasRole } from '@/lib/user';

import AccountsClient from './accounts-client';

export const dynamic = 'force-dynamic';

export default async function AccountsPage() {
  const auth = await getServerAuth();
  if (!auth) redirect('/auth/login');

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  if (!isAdmin && !userHasModule(auth.user, 'accounts')) {
    redirect('/dashboard');
  }

  const organization = await getOrganizationSettings();
  const accounts = await listCustomerAccounts(organization.defaultCurrency);

  return <AccountsClient initialAccounts={accounts} currency={organization.defaultCurrency} />;
}
