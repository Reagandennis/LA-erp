import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { listCustomers } from '@/lib/customers';
import { listApproverCandidates, listQuotesForUser } from '@/lib/quotes';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasModule, userHasRole } from '@/lib/user';

import QuotesClient from './quotes-client';

export const dynamic = 'force-dynamic';

export default async function QuotesPage() {
  const auth = await getServerAuth();
  if (!auth) {
    redirect('/auth/login');
  }

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  if (!isAdmin && !userHasModule(auth.user, 'quotes')) {
    redirect('/dashboard');
  }

  const [quotes, customers, approvers] = await Promise.all([
    listQuotesForUser({ userId: auth.user.id, isAdmin }),
    listCustomers(),
    listApproverCandidates(auth.user.id),
  ]);

  return (
    <QuotesClient
      currentUser={{ id: auth.user.id, name: auth.user.name, email: auth.user.email }}
      isAdmin={isAdmin}
      initialQuotes={quotes}
      initialCustomers={customers}
      initialApprovers={approvers}
    />
  );
}
