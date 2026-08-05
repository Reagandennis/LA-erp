import { NextRequest, NextResponse } from 'next/server';

import { requireRequestAuth } from '@/lib/request-auth';
import { updateCrmCustomer } from '@/lib/crm';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ customerId: string }> },
) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const { customerId: raw } = await params;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Invalid customer id' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const result = await updateCrmCustomer(id, {
    name: typeof body.name === 'string' ? body.name : undefined,
    email: body.email === null || typeof body.email === 'string' ? body.email : undefined,
    phone: body.phone === null || typeof body.phone === 'string' ? body.phone : undefined,
    company: body.company === null || typeof body.company === 'string' ? body.company : undefined,
    address: body.address === null || typeof body.address === 'string' ? body.address : undefined,
    billingAddress:
      body.billingAddress === null || typeof body.billingAddress === 'string'
        ? body.billingAddress
        : undefined,
    entity: typeof body.entity === 'string' ? body.entity : undefined,
  });

  if (result === null) return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ customer: result });
}
