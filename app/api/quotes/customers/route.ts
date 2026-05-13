import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { createCustomer, listCustomers } from '@/lib/customers';
import { enforceRateLimit } from '@/lib/rate-limit';
import { requireRequestAuth } from '@/lib/request-auth';
import { customerCreateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const customers = await listCustomers();
  return NextResponse.json({ customers });
}

export async function POST(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const rateLimit = await enforceRateLimit({
    scope: 'quote.customer.create',
    key: `${auth.user.id}`,
    limit: 30,
    windowMs: 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error: 'Too many customer changes. Slow down and try again.',
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      },
      { status: 429 },
    );
  }

  const body = await request.json().catch(() => null);
  const validation = customerCreateSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: validation.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }

  const customer = await createCustomer({
    name: validation.data.name,
    email: validation.data.email,
    phone: validation.data.phone ?? null,
    company: validation.data.company ?? null,
    address: validation.data.address ?? null,
    createdById: auth.user.id,
  });

  await recordAuditEvent({
    action: 'customer.created',
    entityType: 'customer',
    entityId: String(customer.id),
    actorUserId: auth.user.id,
    metadata: { name: customer.name },
    request,
  });

  return NextResponse.json({ customer }, { status: 201 });
}
