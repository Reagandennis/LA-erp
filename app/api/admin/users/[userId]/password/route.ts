import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { hashPassword } from '@/lib/auth';
import { enforceRateLimit } from '@/lib/rate-limit';
import { requireAdminRequest } from '@/lib/request-auth';
import { getUserAccessById, resetManagedUserPassword } from '@/lib/user';
import { managedUserPasswordResetSchema } from '@/lib/validation';

function parseUserId(value: string) {
  const userId = Number(value);
  return Number.isInteger(userId) && userId > 0 ? userId : null;
}

async function guardAdminMutation(request: NextRequest) {
  const result = await requireAdminRequest(request);

  if (result.response || !result.auth) {
    return result;
  }

  const rateLimit = await enforceRateLimit({
    scope: 'admin.user.mutate',
    key: `${result.auth.user.id}`,
    limit: 30,
    windowMs: 60 * 1000,
  });

  if (!rateLimit.allowed) {
    return {
      auth: null,
      response: NextResponse.json(
        {
          error: 'Too many admin changes. Slow down and try again.',
          retryAfterSeconds: rateLimit.retryAfterSeconds,
        },
        { status: 429 },
      ),
    };
  }

  return result;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { auth, response } = await guardAdminMutation(request);

  if (response || !auth) {
    return response;
  }

  const { userId: rawUserId } = await params;
  const userId = parseUserId(rawUserId);

  if (!userId) {
    return NextResponse.json({ error: 'Invalid user id' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const validation = managedUserPasswordResetSchema.safeParse(body);

  if (!validation.success) {
    return NextResponse.json(
      {
        error: validation.error.issues[0]?.message ?? 'Invalid input',
      },
      { status: 400 },
    );
  }

  const target = await getUserAccessById(userId);

  if (!target) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const isSelf = auth.user.id === userId;
  const passwordHash = await hashPassword(validation.data.password);

  const updatedUser = await resetManagedUserPassword({
    userId,
    passwordHash,
    keepSessionId: isSelf ? auth.sessionId : undefined,
  });

  if (!updatedUser) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  await recordAuditEvent({
    action: 'admin.user.password_reset',
    entityType: 'user',
    entityId: String(userId),
    actorUserId: auth.user.id,
    targetUserId: userId,
    metadata: {
      self: isSelf,
    },
    request,
  });

  return NextResponse.json({ success: true, user: updatedUser });
}
