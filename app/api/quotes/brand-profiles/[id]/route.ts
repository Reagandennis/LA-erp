import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import {
  deleteBrandProfile,
  getBrandProfile,
  updateBrandProfile,
} from '@/lib/brand-profiles';
import { enforceRateLimit } from '@/lib/rate-limit';
import { requireAdminRequest, requireRequestAuth } from '@/lib/request-auth';
import { brandProfileUpdateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseId(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { response } = await requireRequestAuth(request);
  if (response) return response;

  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const profile = await getBrandProfile(id);
  if (!profile) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ profile });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { auth, response } = await requireAdminRequest(request);
  if (response || !auth) return response;

  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const rateLimit = await enforceRateLimit({
    scope: 'quotes.brand-profile.update',
    key: `${auth.user.id}`,
    limit: 60,
    windowMs: 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many changes.', retryAfterSeconds: rateLimit.retryAfterSeconds },
      { status: 429 },
    );
  }

  const body = await request.json().catch(() => null);
  const validation = brandProfileUpdateSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: validation.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }

  try {
    const profile = await updateBrandProfile(id, validation.data);
    await recordAuditEvent({
      action: 'quote.brand-profile.updated',
      entityType: 'brand-profile',
      entityId: String(id),
      actorUserId: auth.user.id,
      metadata: { fields: Object.keys(validation.data) },
      request,
    });
    return NextResponse.json({ profile });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Update failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { auth, response } = await requireAdminRequest(request);
  if (response || !auth) return response;

  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const existing = await getBrandProfile(id);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await deleteBrandProfile(id);
  await recordAuditEvent({
    action: 'quote.brand-profile.deleted',
    entityType: 'brand-profile',
    entityId: String(id),
    actorUserId: auth.user.id,
    metadata: { name: existing.name },
    request,
  });
  return NextResponse.json({ success: true });
}
