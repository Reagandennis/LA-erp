import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { recordAuditEvent } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { enforceRateLimit } from '@/lib/rate-limit';
import { requireAdminRequest } from '@/lib/request-auth';
import { countApprovedDevices, getWebAuthnConfig, setDeviceRequirement } from '@/lib/work-devices';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.union([
  z.object({ required: z.boolean(), userId: z.number().int().positive() }),
  z.object({ required: z.boolean(), everyone: z.literal(true) }),
]);

/**
 * Who has to sign in from an approved work device.
 *
 * PUT { required, userId }          one person
 * PUT { required, everyone: true }  all accounts
 *
 * An admin can never switch the rule on for themselves without an approved
 * device of their own: that would lock them out with nobody signed in to
 * approve one. "Everyone" leaves such an admin out and says so.
 */
export async function PUT(request: NextRequest) {
  const { auth, response } = await requireAdminRequest(request);
  if (response || !auth) return response;

  const rateLimit = await enforceRateLimit({
    scope: 'admin.device.policy',
    key: `${auth.user.id}`,
    limit: 30,
    windowMs: 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many changes. Slow down and try again.', retryAfterSeconds: rateLimit.retryAfterSeconds },
      { status: 429 },
    );
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  const { required } = parsed.data;
  const everyone = 'everyone' in parsed.data;
  const userId = 'userId' in parsed.data ? parsed.data.userId : null;

  if (required && !getWebAuthnConfig(request)) {
    return NextResponse.json(
      { error: 'Set WEBAUTHN_ORIGIN to this site\'s address in the server environment first, then restart the app.' },
      { status: 400 },
    );
  }

  // Would this lock the acting admin out?
  const selfIsSafe = !required || (await countApprovedDevices(auth.user.id)) > 0;

  if (userId !== null) {
    const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    if (userId === auth.user.id && !selfIsSafe) {
      return NextResponse.json(
        { error: 'Register this device and approve it for yourself first, otherwise you would be locked out.' },
        { status: 400 },
      );
    }
  }

  const skippedSelf = everyone && !selfIsSafe;
  const updated = await setDeviceRequirement({
    required,
    userIds: userId !== null ? [userId] : undefined,
    exceptUserId: skippedSelf ? auth.user.id : undefined,
  });

  await recordAuditEvent({
    action: required ? 'admin.device.required' : 'admin.device.not_required',
    entityType: 'user',
    entityId: userId !== null ? String(userId) : null,
    actorUserId: auth.user.id,
    targetUserId: userId,
    metadata: { scope: everyone ? 'everyone' : 'user', updated, skippedSelf },
    request,
  });

  return NextResponse.json({ success: true, updated, skippedSelf });
}
