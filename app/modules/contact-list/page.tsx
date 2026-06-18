import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { listContacts, listCustomerOptions } from '@/lib/contacts';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasModule, userHasRole } from '@/lib/user';

import ContactsClient from './contacts-client';

export const dynamic = 'force-dynamic';

export default async function ContactListPage() {
  const auth = await getServerAuth();
  if (!auth) {
    redirect('/auth/login');
  }

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  if (!isAdmin && !userHasModule(auth.user, 'contact-list')) {
    redirect('/dashboard');
  }

  const [contacts, customers] = await Promise.all([listContacts(), listCustomerOptions()]);

  return <ContactsClient initialContacts={contacts} initialCustomers={customers} />;
}
