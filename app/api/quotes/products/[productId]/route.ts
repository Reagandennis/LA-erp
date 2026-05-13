import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { deleteProduct, getProductById, updateProduct } from '@/lib/products';
import { requireRequestAuth } from '@/lib/request-auth';
import { productUpdateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseId(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> },
) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const { productId: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const product = await getProductById(id);
  if (!product) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ product });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> },
) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const { productId: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const body = await request.json().catch(() => null);
  const validation = productUpdateSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: validation.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }

  const existing = await getProductById(id);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const product = await updateProduct(id, {
    name: validation.data.name,
    description: validation.data.description ?? null,
    sku: validation.data.sku ?? null,
    defaultUnitPrice: validation.data.defaultUnitPrice,
    currency: validation.data.currency,
    taxable: validation.data.taxable,
    archived: validation.data.archived,
  });

  await recordAuditEvent({
    action: 'quote.product.updated',
    entityType: 'product',
    entityId: String(id),
    actorUserId: auth.user.id,
    metadata: { name: product.name },
    request,
  });

  return NextResponse.json({ product });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> },
) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const { productId: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const existing = await getProductById(id);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await deleteProduct(id);

  await recordAuditEvent({
    action: 'quote.product.deleted',
    entityType: 'product',
    entityId: String(id),
    actorUserId: auth.user.id,
    metadata: { name: existing.name },
    request,
  });

  return NextResponse.json({ success: true });
}
