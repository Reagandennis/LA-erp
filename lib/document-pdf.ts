import 'server-only';

import { getBrandProfile, getBrandProfileLogo } from './brand-profiles';
import { getCustomerById } from './customers';
import { renderInvoicePdf } from './invoice-pdf';
import type { InvoiceDetail } from './invoices';
import { getOrganizationLogo, getOrganizationSettings } from './organization';
import { renderQuotePdf } from './quote-pdf';
import type { QuoteDetail } from './quotes';

interface DocumentCustomerRef {
  id: number;
  name: string;
  company: string | null;
  email: string | null;
}

/**
 * Resolves the brand block, tax label, logo and customer address used by both
 * the invoice and quote PDFs. Centralised so the PDF download routes and the
 * email-attachment path stay in sync.
 */
async function resolveDocumentContext(args: {
  brandProfileId: number | null;
  customer: DocumentCustomerRef;
}) {
  const [organization, customer, brandProfile] = await Promise.all([
    getOrganizationSettings(),
    getCustomerById(args.customer.id),
    args.brandProfileId ? getBrandProfile(args.brandProfileId) : Promise.resolve(null),
  ]);

  const [orgLogo, brandLogo] = await Promise.all([
    brandProfile ? Promise.resolve(null) : getOrganizationLogo(),
    brandProfile?.hasLogo ? getBrandProfileLogo(brandProfile.id) : Promise.resolve(null),
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
      };

  return {
    organization,
    brand,
    taxLabel: organization.taxLabel || 'Tax',
    logo: brandProfile ? brandLogo : orgLogo,
    customer: {
      name: args.customer.name,
      company: args.customer.company,
      email: args.customer.email,
      address: customer?.address ?? null,
      billingAddress: customer?.billingAddress ?? null,
    },
  };
}

/** Renders an invoice to a PDF buffer with full brand/logo context. */
export async function buildInvoicePdf(invoice: InvoiceDetail): Promise<Buffer> {
  const ctx = await resolveDocumentContext({
    brandProfileId: invoice.brandProfile?.id ?? null,
    customer: invoice.customer,
  });
  return renderInvoicePdf({
    invoice,
    brand: ctx.brand,
    taxLabel: ctx.taxLabel,
    logo: ctx.logo,
    customer: ctx.customer,
  });
}

/** Renders a quote to a PDF buffer with full brand/logo context. */
export async function buildQuotePdf(quote: QuoteDetail): Promise<Buffer> {
  const ctx = await resolveDocumentContext({
    brandProfileId: quote.brandProfile?.id ?? null,
    customer: quote.customer,
  });
  return renderQuotePdf({
    quote,
    brand: ctx.brand,
    taxLabel: ctx.taxLabel,
    logo: ctx.logo,
    customer: ctx.customer,
  });
}
