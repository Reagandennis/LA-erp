import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { createProduct, listProducts } from '@/lib/products';
import { enforceRateLimit } from '@/lib/rate-limit';
import { requireRequestAuth } from '@/lib/request-auth';
import { productCreateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const includeArchived = request.nextUrl.searchParams.get('includeArchived') === 'true';
  const products = await listProducts({ includeArchived });
  return NextResponse.json({ products });
}

export async function POST(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const rateLimit = await enforceRateLimit({
    scope: 'quote.product.create',
    key: `${auth.user.id}`,
    limit: 30,
    windowMs: 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many product changes. Slow down and try again.', retryAfterSeconds: rateLimit.retryAfterSeconds },
      { status: 429 },
    );
  }

  const body = await request.json().catch(() => null);
  const validation = productCreateSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: validation.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }

  const product = await createProduct({
    name: validation.data.name,
    description: validation.data.description ?? null,
    sku: validation.data.sku ?? null,
    defaultUnitPrice: validation.data.defaultUnitPrice,
    currency: validation.data.currency,
    taxable: validation.data.taxable,
    createdById: auth.user.id,
  });

  await recordAuditEvent({
    action: 'quote.product.created',
    entityType: 'product',
    entityId: String(product.id),
    actorUserId: auth.user.id,
    metadata: { name: product.name },
    request,
  });

  return NextResponse.json({ product }, { status: 201 });
}
