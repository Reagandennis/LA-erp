import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { listCustomerOptions } from '@/lib/contacts';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { listTravelers } from '@/lib/travelers';
import { userHasModule, userHasRole } from '@/lib/user';

import TravelersClient from './travelers-client';

export const dynamic = 'force-dynamic';

export default async function TravelersPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const auth = await getServerAuth();
  if (!auth) {
    redirect('/auth/login');
  }

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  if (!isAdmin && !userHasModule(auth.user, 'travelers')) {
    redirect('/dashboard');
  }

  // Global search deep-links straight onto a traveller.
  const { open } = await searchParams;
  const openId = Number(Array.isArray(open) ? open[0] : open);

  const [items, customers] = await Promise.all([listTravelers(), listCustomerOptions()]);

  return (
    <TravelersClient
      isAdmin={isAdmin}
      initialItems={items}
      initialCustomers={customers}
      initialOpenId={Number.isInteger(openId) && openId > 0 ? openId : null}
    />
  );
}
