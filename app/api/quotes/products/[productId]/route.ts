import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { SERVICE_DETAIL_KEYS, deleteProduct, findProductWithSku, getProductById, updateProduct } from '@/lib/products';
import { API_ACCESS } from '@/lib/api-access';
import { requireModuleRequest } from '@/lib/request-auth';
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
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.quoteProducts);
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
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.quoteProducts);
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

  const { data } = validation;
  const sku = data.sku === undefined ? undefined : data.sku || null;
  const clash = sku ? await findProductWithSku(sku, id) : null;
  if (clash) {
    return NextResponse.json({ error: `Service code ${sku} is already used by “${clash.name}”.` }, { status: 409 });
  }

  // A field left out of the request stays as it is; null clears it.
  const product = await updateProduct(id, {
    name: data.name,
    description: data.description,
    sku,
    defaultUnitPrice: data.defaultUnitPrice,
    currency: data.currency,
    taxable: data.taxable,
    archived: data.archived,
    ...Object.fromEntries(SERVICE_DETAIL_KEYS.map((key) => [key, data[key]])),
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
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.quoteProducts);
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
