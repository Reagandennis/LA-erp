import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { listCustomers } from '@/lib/customers';
import { getOrganizationSettings } from '@/lib/organization';
import { listProducts } from '@/lib/products';
import { listApproverCandidates, listQuotesForUser } from '@/lib/quotes';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { listTemplates } from '@/lib/templates';
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

  const [quotes, customers, approvers, products, templates, organization] = await Promise.all([
    listQuotesForUser({ userId: auth.user.id, isAdmin }),
    listCustomers(),
    listApproverCandidates(auth.user.id),
    listProducts(),
    listTemplates(),
    getOrganizationSettings(),
  ]);

  return (
    <QuotesClient
      currentUser={{ id: auth.user.id, name: auth.user.name, email: auth.user.email }}
      isAdmin={isAdmin}
      initialQuotes={quotes}
      initialCustomers={customers}
      initialApprovers={approvers}
      initialProducts={products}
      initialTemplates={templates}
      organization={{
        companyName: organization.companyName,
        defaultCurrency: organization.defaultCurrency,
        defaultTaxRate: organization.defaultTaxRate,
        taxLabel: organization.taxLabel,
        hasLogo: organization.hasLogo,
      }}
    />
  );
}
