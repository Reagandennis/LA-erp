import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { getOrganizationSettings, updateOrganizationSettings } from '@/lib/organization';
import { enforceRateLimit } from '@/lib/rate-limit';
import { requireAdminRequest, requireRequestAuth } from '@/lib/request-auth';
import { organizationUpdateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Anyone authenticated can read branding (the builder + PDF reads it)
export async function GET(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;
  const settings = await getOrganizationSettings();
  return NextResponse.json({ settings });
}

export async function PATCH(request: NextRequest) {
  const { auth, response } = await requireAdminRequest(request);
  if (response || !auth) return response;

  const rateLimit = await enforceRateLimit({
    scope: 'admin.organization.update',
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
  const validation = organizationUpdateSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: validation.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }

  const settings = await updateOrganizationSettings(validation.data, auth.user.id);

  await recordAuditEvent({
    action: 'admin.organization.updated',
    entityType: 'organization',
    actorUserId: auth.user.id,
    metadata: { fields: Object.keys(validation.data) },
    request,
  });

  return NextResponse.json({ settings });
}
