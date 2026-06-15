import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { getBrandProfile, getBrandProfileLogo } from '@/lib/brand-profiles';
import { getCustomerById } from '@/lib/customers';
import { renderInvoicePdf } from '@/lib/invoice-pdf';
import { getInvoice } from '@/lib/invoices';
import { getOrganizationLogo, getOrganizationSettings } from '@/lib/organization';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireRequestAuth } from '@/lib/request-auth';
import { userHasModule, userHasRole } from '@/lib/user';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

function parseId(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ invoiceId: string }> }) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;
  if (!userHasRole(auth.user, ADMIN_ROLE_NAME) && !userHasModule(auth.user, 'invoices-review')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { invoiceId: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid invoice id' }, { status: 400 });

  const invoice = await getInvoice(id);
  if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

  const [organization, customer, brandProfile] = await Promise.all([
    getOrganizationSettings(),
    getCustomerById(invoice.customer.id),
    invoice.brandProfile?.id ? getBrandProfile(invoice.brandProfile.id) : Promise.resolve(null),
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

  const buffer = await renderInvoicePdf({
    invoice,
    brand,
    taxLabel: organization.taxLabel || 'Tax',
    logo: brandProfile ? brandLogo : orgLogo,
    customer: {
      name: invoice.customer.name,
      company: invoice.customer.company,
      email: invoice.customer.email,
      address: customer?.address ?? null,
      billingAddress: customer?.billingAddress ?? null,
    },
  });

  await recordAuditEvent({
    action: 'invoice.pdf.downloaded',
    entityType: 'invoice',
    entityId: String(id),
    actorUserId: auth.user.id,
    metadata: { number: invoice.number },
    request,
  });

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${invoice.number}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
