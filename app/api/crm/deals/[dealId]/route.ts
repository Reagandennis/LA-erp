import { NextRequest, NextResponse } from 'next/server';

import { requireRequestAuth } from '@/lib/request-auth';
import { deleteDeal, updateDeal } from '@/lib/crm';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseId(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const { dealId: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid deal id' }, { status: 400 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const result = await updateDeal(id, {
    title: typeof body.title === 'string' ? body.title : undefined,
    stage: typeof body.stage === 'string' ? body.stage : undefined,
    value: typeof body.value === 'number' ? body.value : undefined,
    currency: typeof body.currency === 'string' ? body.currency : undefined,
    quoteId: body.quoteId === null || typeof body.quoteId === 'number' ? body.quoteId : undefined,
    contractId: body.contractId === null || typeof body.contractId === 'number' ? body.contractId : undefined,
    signatureStatus: typeof body.signatureStatus === 'string' ? body.signatureStatus : undefined,
    expectedCloseDate:
      body.expectedCloseDate === null || typeof body.expectedCloseDate === 'string'
        ? body.expectedCloseDate
        : undefined,
    lostReason: body.lostReason === null || typeof body.lostReason === 'string' ? body.lostReason : undefined,
    notes: body.notes === null || typeof body.notes === 'string' ? body.notes : undefined,
  });

  if (result === null) return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ deal: result });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const { dealId: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid deal id' }, { status: 400 });

  const deleted = await deleteDeal(id);
  if (!deleted) return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
