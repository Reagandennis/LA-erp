import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { listCustomerOptions } from '@/lib/contacts';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { listTravelers } from '@/lib/travelers';
import { userHasModule, userHasRole } from '@/lib/user';

import TravelersClient from './travelers-client';

export const dynamic = 'force-dynamic';

export default async function TravelersPage() {
  const auth = await getServerAuth();
  if (!auth) {
    redirect('/auth/login');
  }

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  if (!isAdmin && !userHasModule(auth.user, 'travelers')) {
    redirect('/dashboard');
  }

  const [items, customers] = await Promise.all([listTravelers(), listCustomerOptions()]);

  return <TravelersClient isAdmin={isAdmin} initialItems={items} initialCustomers={customers} />;
}
