import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { listContacts, listCustomerOptions } from '@/lib/contacts';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasModule, userHasRole } from '@/lib/user';

import ContactsClient from './contacts-client';

export const dynamic = 'force-dynamic';

export default async function ContactListPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const auth = await getServerAuth();
  if (!auth) {
    redirect('/auth/login');
  }

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  if (!isAdmin && !userHasModule(auth.user, 'contact-list')) {
    redirect('/dashboard');
  }

  // Global search deep-links straight onto a contact (`?open=<contactId>`).
  const { open } = await searchParams;
  const openId = Number(Array.isArray(open) ? open[0] : open);

  const [contacts, customers] = await Promise.all([listContacts(), listCustomerOptions()]);

  return (
    <ContactsClient
      initialContacts={contacts}
      initialCustomers={customers}
      initialOpenId={Number.isInteger(openId) && openId > 0 ? openId : null}
    />
  );
}
