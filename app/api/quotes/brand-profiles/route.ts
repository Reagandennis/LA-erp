import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { createBrandProfile, listBrandProfiles } from '@/lib/brand-profiles';
import { enforceRateLimit } from '@/lib/rate-limit';
import { requireAdminRequest, requireRequestAuth } from '@/lib/request-auth';
import { brandProfileCreateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Anyone authenticated can read the list (builder needs it for the picker)
export async function GET(request: NextRequest) {
  const { response } = await requireRequestAuth(request);
  if (response) return response;
  const profiles = await listBrandProfiles({ includeArchived: false });
  return NextResponse.json({ profiles });
}

export async function POST(request: NextRequest) {
  const { auth, response } = await requireAdminRequest(request);
  if (response || !auth) return response;

  const rateLimit = await enforceRateLimit({
    scope: 'quotes.brand-profile.create',
    key: `${auth.user.id}`,
    limit: 30,
    windowMs: 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many changes.', retryAfterSeconds: rateLimit.retryAfterSeconds },
      { status: 429 },
    );
  }

  const body = await request.json().catch(() => null);
  const validation = brandProfileCreateSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: validation.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }

  const profile = await createBrandProfile(
    { ...validation.data, name: validation.data.name },
    auth.user.id,
  );

  await recordAuditEvent({
    action: 'quote.brand-profile.created',
    entityType: 'brand-profile',
    entityId: String(profile.id),
    actorUserId: auth.user.id,
    metadata: { name: profile.name, isDefault: profile.isDefault },
    request,
  });

  return NextResponse.json({ profile }, { status: 201 });
}
