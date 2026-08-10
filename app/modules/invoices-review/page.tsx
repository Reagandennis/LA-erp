import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { listBrandProfiles } from '@/lib/brand-profiles';
import { listCustomers } from '@/lib/customers';
import { listInvoiceApproverCandidates, listInvoiceableQuotes, listInvoices } from '@/lib/invoices';
import { getOrganizationSettings } from '@/lib/organization';
import { getQuickBooksStatus } from '@/lib/quickbooks';
import { getWaveStatus } from '@/lib/wave';
import { listProducts } from '@/lib/products';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasModule, userHasRole } from '@/lib/user';

import InvoicesClient from './invoices-client';

export const dynamic = 'force-dynamic';

export default async function InvoicesReviewPage() {
  const auth = await getServerAuth();
  if (!auth) redirect('/auth/login');

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  if (!isAdmin && !userHasModule(auth.user, 'invoices-review')) {
    redirect('/dashboard');
  }

  const [invoices, customers, products, brandProfiles, organization, invoiceableQuotes, quickBooks, wave, approvers] =
    await Promise.all([
      listInvoices(),
      listCustomers(),
      listProducts(),
      listBrandProfiles({ includeArchived: false }),
      getOrganizationSettings(),
      listInvoiceableQuotes(),
      getQuickBooksStatus(),
      getWaveStatus(),
      listInvoiceApproverCandidates(auth.user.id),
    ]);

  return (
    <InvoicesClient
      currentUser={{ id: auth.user.id, name: auth.user.name, email: auth.user.email }}
      isAdmin={isAdmin}
      initialInvoices={invoices}
      customers={customers}
      products={products}
      brandProfiles={brandProfiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        companyName: profile.companyName,
        primaryColor: profile.primaryColor,
        isDefault: profile.isDefault,
        hasLogo: profile.hasLogo,
      }))}
      invoiceableQuotes={invoiceableQuotes}
      organization={{
        companyName: organization.companyName,
        defaultCurrency: organization.defaultCurrency,
        defaultTaxRate: organization.defaultTaxRate,
        taxLabel: organization.taxLabel,
        hasLogo: organization.hasLogo,
      }}
      quickBooks={{ configured: quickBooks.configured, connected: quickBooks.connected }}
      wave={{ configured: wave.configured, connected: wave.connected }}
      approvers={approvers}
    />
  );
}
