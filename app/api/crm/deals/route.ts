import { NextRequest, NextResponse } from 'next/server';

import { requireRequestAuth } from '@/lib/request-auth';
import { createDeal, listDeals } from '@/lib/crm';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  return NextResponse.json({ deals: await listDeals() });
}

export async function POST(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || typeof body.customerId !== 'number') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const result = await createDeal(auth.user.id, {
    title: String(body.title ?? ''),
    customerId: body.customerId,
    stage: typeof body.stage === 'string' ? body.stage : undefined,
    value: typeof body.value === 'number' ? body.value : undefined,
    currency: typeof body.currency === 'string' ? body.currency : undefined,
    quoteId: typeof body.quoteId === 'number' ? body.quoteId : null,
    contractId: typeof body.contractId === 'number' ? body.contractId : null,
    expectedCloseDate: typeof body.expectedCloseDate === 'string' ? body.expectedCloseDate : null,
    notes: typeof body.notes === 'string' ? body.notes : null,
  });

  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ deal: result }, { status: 201 });
}
