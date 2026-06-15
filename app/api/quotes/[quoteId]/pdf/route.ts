import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { getBrandProfile, getBrandProfileLogo } from '@/lib/brand-profiles';
import { getCustomerById } from '@/lib/customers';
import { getOrganizationLogo, getOrganizationSettings } from '@/lib/organization';
import { renderQuotePdf } from '@/lib/quote-pdf';
import { getQuoteForUser } from '@/lib/quotes';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireRequestAuth } from '@/lib/request-auth';
import { userHasRole } from '@/lib/user';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

function parseQuoteId(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ quoteId: string }> },
) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const { quoteId: raw } = await params;
  const quoteId = parseQuoteId(raw);
  if (!quoteId) return NextResponse.json({ error: 'Invalid quote id' }, { status: 400 });

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  const quote = await getQuoteForUser({ id: quoteId, userId: auth.user.id, isAdmin });
  if (!quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 });

  const [organization, customer, brandProfile] = await Promise.all([
    getOrganizationSettings(),
    getCustomerById(quote.customer.id),
    quote.brandProfile?.id ? getBrandProfile(quote.brandProfile.id) : Promise.resolve(null),
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

  const buffer = await renderQuotePdf({
    quote,
    brand,
    taxLabel: organization.taxLabel || 'Tax',
    logo: brandProfile ? brandLogo : orgLogo,
    customer: {
      name: quote.customer.name,
      company: quote.customer.company,
      email: quote.customer.email,
      address: customer?.address ?? null,
      billingAddress: customer?.billingAddress ?? null,
    },
  });

  await recordAuditEvent({
    action: 'quote.pdf.downloaded',
    entityType: 'quote',
    entityId: String(quoteId),
    actorUserId: auth.user.id,
    metadata: { reference: quote.reference },
    request,
  });

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${quote.reference}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
