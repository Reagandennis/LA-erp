import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { enforceRateLimit } from '@/lib/rate-limit';
import { requireAdminRequest } from '@/lib/request-auth';
import { getUploadLimits, updateUploadLimits } from '@/lib/upload-limits';
import { uploadLimitsUpdateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const { auth, response } = await requireAdminRequest(request);
  if (response || !auth) return response;

  const limits = await getUploadLimits();
  return NextResponse.json({ limits });
}

export async function PUT(request: NextRequest) {
  const { auth, response } = await requireAdminRequest(request);
  if (response || !auth) return response;

  const rateLimit = await enforceRateLimit({
    scope: 'admin.upload_limits.update',
    key: `${auth.user.id}`,
    limit: 10,
    windowMs: 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error: 'Too many changes. Slow down and try again.',
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      },
      { status: 429 },
    );
  }

  const body = await request.json().catch(() => null);
  const validation = uploadLimitsUpdateSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: validation.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }

  const before = await getUploadLimits();
  const limits = await updateUploadLimits(validation.data, auth.user.id);

  await recordAuditEvent({
    action: 'admin.upload_limits.updated',
    entityType: 'settings',
    entityId: 'upload-limits',
    actorUserId: auth.user.id,
    metadata: { before: { ...before }, after: { ...limits } },
    request,
  });

  return NextResponse.json({ limits });
}
