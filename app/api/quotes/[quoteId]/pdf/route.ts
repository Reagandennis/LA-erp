import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { buildQuotePdf } from '@/lib/document-pdf';
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

  const buffer = await buildQuotePdf(quote);

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
