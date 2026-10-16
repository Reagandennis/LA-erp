import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { enforceRateLimit } from '@/lib/rate-limit';
import { API_ACCESS } from '@/lib/api-access';
import { requireModuleRequest } from '@/lib/request-auth';
import { createTemplate, listTemplates } from '@/lib/templates';
import { templateCreateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.quotes);
  if (response || !auth) return response;

  const templates = await listTemplates();
  return NextResponse.json({ templates });
}

export async function POST(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.quotes);
  if (response || !auth) return response;

  const rateLimit = await enforceRateLimit({
    scope: 'quote.template.create',
    key: `${auth.user.id}`,
    limit: 30,
    windowMs: 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many template changes.', retryAfterSeconds: rateLimit.retryAfterSeconds },
      { status: 429 },
    );
  }

  const body = await request.json().catch(() => null);
  const validation = templateCreateSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: validation.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }

  const template = await createTemplate({
    name: validation.data.name,
    description: validation.data.description ?? null,
    taxRate: validation.data.taxRate,
    currency: validation.data.currency,
    terms: validation.data.terms ?? null,
    notes: validation.data.notes ?? null,
    discountType: validation.data.discountType,
    discountValue: validation.data.discountValue,
    items: validation.data.items.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      days: item.days ?? 1,
      unitPrice: item.unitPrice,
      taxable: item.taxable ?? true,
      discountType: item.discountType ?? 'none',
      discountValue: item.discountValue ?? 0,
      productId: item.productId ?? null,
    })),
    createdById: auth.user.id,
  });

  await recordAuditEvent({
    action: 'quote.template.created',
    entityType: 'quote.template',
    entityId: String(template.id),
    actorUserId: auth.user.id,
    metadata: { name: template.name },
    request,
  });

  return NextResponse.json({ template }, { status: 201 });
}
