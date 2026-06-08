import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { listBrandProfiles } from '@/lib/brand-profiles';
import { listCustomers } from '@/lib/customers';
import { getOrganizationSettings } from '@/lib/organization';
import { listProducts } from '@/lib/products';
import {
  getQuoteForUser,
  listApproverCandidates,
} from '@/lib/quotes';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { listTemplates } from '@/lib/templates';
import { userHasModule, userHasRole } from '@/lib/user';

import QuoteFormClient from '../../quote-form-client';

export const dynamic = 'force-dynamic';

interface EditPageProps {
  params: Promise<{ quoteId: string }>;
}

export default async function EditQuotePage({ params }: EditPageProps) {
  const auth = await getServerAuth();
  if (!auth) redirect('/auth/login');

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  if (!isAdmin && !userHasModule(auth.user, 'quotes')) {
    redirect('/dashboard');
  }

  const { quoteId: raw } = await params;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) redirect('/modules/quotes');

  const quote = await getQuoteForUser({ id, userId: auth.user.id, isAdmin });
  if (!quote) redirect('/modules/quotes');

  const [customers, approvers, products, templates, organization, brandProfiles] =
    await Promise.all([
      listCustomers(),
      listApproverCandidates(auth.user.id),
      listProducts(),
      listTemplates(),
      getOrganizationSettings(),
      listBrandProfiles({ includeArchived: false }),
    ]);

  return (
    <QuoteFormClient
      mode="edit"
      quote={quote}
      customers={customers}
      approvers={approvers}
      products={products}
      templates={templates}
      brandProfiles={brandProfiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        companyName: profile.companyName,
        primaryColor: profile.primaryColor,
        isDefault: profile.isDefault,
        hasLogo: profile.hasLogo,
      }))}
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
