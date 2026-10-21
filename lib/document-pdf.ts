import 'server-only';

import type { ClientItinerary } from '@/app/modules/trip-planning/[tripId]/client-itinerary';

import { getBrandProfile, getBrandProfileLogo } from './brand-profiles';
import { getCustomerById } from './customers';
import { renderInvoicePdf } from './invoice-pdf';
import type { InvoiceDetail } from './invoices';
import { getOrganizationLogo, getOrganizationSettings } from './organization';
import { type BrandPdfInfo, renderQuotePdf } from './quote-pdf';
import type { QuoteDetail } from './quotes';
import { loadPdfPhotos } from './trip-attachments';
import { pdfPhotoIds, renderTripItineraryPdf } from './trip-pdf';

interface DocumentCustomerRef {
  id: number;
  name: string;
  company: string | null;
  email: string | null;
}

/**
 * The brand a document goes out under: its brand profile, or the organization.
 * Shared with the trip share page, which shows the same header as the PDF.
 */
export async function resolveDocumentBrand(brandProfileId: number | null): Promise<{
  brand: BrandPdfInfo;
  logo: { buffer: Buffer; mimeType: string } | null;
  taxLabel: string;
}> {
  const [organization, brandProfile] = await Promise.all([
    getOrganizationSettings(),
    brandProfileId ? getBrandProfile(brandProfileId) : Promise.resolve(null),
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

  return { brand, taxLabel: organization.taxLabel || 'Tax', logo: brandProfile ? brandLogo : orgLogo };
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
  const [{ brand, logo, taxLabel }, customer] = await Promise.all([
    resolveDocumentBrand(args.brandProfileId),
    getCustomerById(args.customer.id),
  ]);

  return {
    brand,
    taxLabel,
    logo,
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

/** Renders a trip's client itinerary under the brand of the quote it came from. */
export async function buildTripItineraryPdf(
  itinerary: ClientItinerary,
  brandProfileId: number | null,
): Promise<Buffer> {
  const { brand, logo } = await resolveDocumentBrand(brandProfileId);
  return renderItineraryPdf({ itinerary, brand, logo });
}

/** The itinerary PDF for a brand already in hand, with the photos it shares. */
export async function renderItineraryPdf(input: {
  itinerary: ClientItinerary;
  brand: BrandPdfInfo;
  logo: { buffer: Buffer; mimeType: string } | null;
}): Promise<Buffer> {
  const photos = await loadPdfPhotos(pdfPhotoIds(input.itinerary));
  return renderTripItineraryPdf({ ...input, photos });
}
