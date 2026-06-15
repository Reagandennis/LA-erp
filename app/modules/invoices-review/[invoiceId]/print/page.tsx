import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { getBrandProfile } from '@/lib/brand-profiles';
import { getCustomerById } from '@/lib/customers';
import { getInvoice } from '@/lib/invoices';
import { getOrganizationSettings } from '@/lib/organization';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasModule, userHasRole } from '@/lib/user';

import PrintView from './print-view';

export const dynamic = 'force-dynamic';

interface PrintPageProps {
  params: Promise<{ invoiceId: string }>;
}

export default async function InvoicePrintPage({ params }: PrintPageProps) {
  const auth = await getServerAuth();
  if (!auth) redirect('/auth/login');

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  if (!isAdmin && !userHasModule(auth.user, 'invoices-review')) {
    redirect('/dashboard');
  }

  const { invoiceId: raw } = await params;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) redirect('/modules/invoices-review');

  const invoice = await getInvoice(id);
  if (!invoice) redirect('/modules/invoices-review');

  const [organization, customer, brandProfile] = await Promise.all([
    getOrganizationSettings(),
    getCustomerById(invoice.customer.id),
    invoice.brandProfile?.id ? getBrandProfile(invoice.brandProfile.id) : Promise.resolve(null),
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
        logoUrl: brandProfile.hasLogo ? `/api/quotes/brand-profiles/${brandProfile.id}/logo` : null,
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
        primaryColor: '#03458f',
        logoUrl: organization.hasLogo ? '/api/admin/organization/logo' : null,
      };

  return (
    <PrintView
      invoice={invoice}
      taxLabel={organization.taxLabel || 'Tax'}
      brand={brand}
      customer={{
        name: invoice.customer.name,
        company: invoice.customer.company,
        email: invoice.customer.email,
        address: customer?.address ?? null,
        billingAddress: customer?.billingAddress ?? null,
      }}
    />
  );
}
