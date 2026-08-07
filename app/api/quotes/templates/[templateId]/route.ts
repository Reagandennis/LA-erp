import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { requireRequestAuth } from '@/lib/request-auth';
import { deleteTemplate, getTemplate, updateTemplate } from '@/lib/templates';
import { templateUpdateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseId(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ templateId: string }> },
) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;
  const { templateId: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const template = await getTemplate(id);
  if (!template) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ template });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ templateId: string }> },
) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;
  const { templateId: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const body = await request.json().catch(() => null);
  const validation = templateUpdateSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: validation.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }

  const existing = await getTemplate(id);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const template = await updateTemplate(id, {
    name: validation.data.name,
    description: validation.data.description,
    taxRate: validation.data.taxRate,
    currency: validation.data.currency,
    terms: validation.data.terms,
    notes: validation.data.notes,
    discountType: validation.data.discountType,
    discountValue: validation.data.discountValue,
    items: validation.data.items?.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      days: item.days ?? 1,
      unitPrice: item.unitPrice,
      taxable: item.taxable ?? true,
      discountType: item.discountType ?? 'none',
      discountValue: item.discountValue ?? 0,
      productId: item.productId ?? null,
    })),
  });

  await recordAuditEvent({
    action: 'quote.template.updated',
    entityType: 'quote.template',
    entityId: String(id),
    actorUserId: auth.user.id,
    metadata: { name: template.name },
    request,
  });

  return NextResponse.json({ template });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ templateId: string }> },
) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;
  const { templateId: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const existing = await getTemplate(id);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await deleteTemplate(id);

  await recordAuditEvent({
    action: 'quote.template.deleted',
    entityType: 'quote.template',
    entityId: String(id),
    actorUserId: auth.user.id,
    metadata: { name: existing.name },
    request,
  });

  return NextResponse.json({ success: true });
}
