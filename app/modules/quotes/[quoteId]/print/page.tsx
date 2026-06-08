import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { getBrandProfile } from '@/lib/brand-profiles';
import { getCustomerById } from '@/lib/customers';
import { getOrganizationSettings } from '@/lib/organization';
import { getQuoteForUser } from '@/lib/quotes';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasModule, userHasRole } from '@/lib/user';

import PrintView from './print-view';

export const dynamic = 'force-dynamic';

interface PrintPageProps {
  params: Promise<{ quoteId: string }>;
}

export default async function QuotePrintPage({ params }: PrintPageProps) {
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

  const [organization, customer, brandProfile] = await Promise.all([
    getOrganizationSettings(),
    getCustomerById(quote.customer.id),
    quote.brandProfile?.id ? getBrandProfile(quote.brandProfile.id) : Promise.resolve(null),
  ]);

  const brand = brandProfile
    ? {
        companyName: brandProfile.companyName ?? organization.companyName,
        addressLine1: brandProfile.addressLine1,
        addressLine2: brandProfile.addressLine2,
        city: brandProfile.city,
        region: brandProfile.region,
        postalCode: brandProfile.postalCode,
        country: brandProfile.country,
        email: brandProfile.email,
        phone: brandProfile.phone,
        website: brandProfile.website,
        primaryColor: brandProfile.primaryColor,
        logoUrl: brandProfile.hasLogo
          ? `/api/quotes/brand-profiles/${brandProfile.id}/logo`
          : null,
      }
    : {
        companyName: organization.companyName,
        addressLine1: organization.addressLine1,
        addressLine2: organization.addressLine2,
        city: organization.city,
        region: organization.region,
        postalCode: organization.postalCode,
        country: organization.country,
        email: organization.email,
        phone: organization.phone,
        website: organization.website,
        primaryColor: '#059669',
        logoUrl: organization.hasLogo ? '/api/admin/organization/logo' : null,
      };

  return (
    <PrintView
      quote={quote}
      taxLabel={organization.taxLabel || 'Tax'}
      brand={brand}
      customer={{
        name: quote.customer.name,
        company: quote.customer.company,
        email: quote.customer.email,
        address: customer?.address ?? null,
        billingAddress: customer?.billingAddress ?? null,
      }}
    />
  );
}
