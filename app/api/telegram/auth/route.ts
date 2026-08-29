import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { enforceRateLimit } from '@/lib/rate-limit';
import { resolveMessagingRequest } from '@/lib/messaging-routes';
import { logout, startLogin, submitCode, submitPassword } from '@/lib/telegram';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

/**
 * Telegram account sign-in: phone → code → (optional) 2FA password.
 *
 * Each user signs in as themselves — the session is stored against their own
 * platform user id, so this authorises only their own account and gives no
 * access to anyone else's.
 */
export async function POST(request: NextRequest) {
  const { ctx, response } = await resolveMessagingRequest(request, 'telegram');
  if (response || !ctx) return response;

  // Login codes are rate limited by Telegram too; failing fast here avoids
  // burning those attempts and locking the number out.
  const rateLimit = await enforceRateLimit({
    scope: 'telegram.auth',
    key: `${ctx.userId}`,
    limit: 10,
    windowMs: 10 * 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many sign-in attempts. Wait a few minutes and try again.' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    );
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'bad-request' }, { status: 400 });

  const step = String(body.step ?? '').trim();

  if (step === 'logout') {
    const result = await logout(ctx.userId);
    await recordAuditEvent({
      action: 'telegram.signed_out',
      entityType: 'telegram-session',
      actorUserId: ctx.userId,
      request,
    });
    return NextResponse.json(result);
  }

  if (step === 'start') {
    const result = await startLogin(ctx.userId, String(body.phoneNumber ?? ''));
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  }

  if (step === 'code') {
    const result = await submitCode(ctx.userId, String(body.code ?? ''));
    if (result.stage === 'signed-in') {
      await recordAuditEvent({
        action: 'telegram.signed_in',
        entityType: 'telegram-session',
        actorUserId: ctx.userId,
        metadata: { label: result.label ?? null },
        request,
      });
    }
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  }

  if (step === 'password') {
    const result = await submitPassword(ctx.userId, String(body.password ?? ''));
    if (result.stage === 'signed-in') {
      await recordAuditEvent({
        action: 'telegram.signed_in',
        entityType: 'telegram-session',
        actorUserId: ctx.userId,
        metadata: { label: result.label ?? null, twoFactor: true },
        request,
      });
    }
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  }

  return NextResponse.json({ error: 'Unknown step.' }, { status: 400 });
}
