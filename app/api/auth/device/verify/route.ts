import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { createSession } from '@/lib/auth';
import { recordAuditEvent } from '@/lib/audit';
import { getClearedDeviceGateCookieOptions } from '@/lib/device-gate';
import { getSessionCookieOptions } from '@/lib/session-token';
import {
  DeviceCheckError,
  deviceErrorResponse,
  finishDeviceVerification,
  getClientIp,
  requireWebAuthnConfig,
  resolveDevicePrincipal,
} from '@/lib/work-devices';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  response: z.looseObject({ id: z.string().min(1), response: z.looseObject({}) }),
});

/**
 * Last step of signing in for people limited to approved work devices: the
 * device proves itself and, if it is approved, the session is opened here.
 */
export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const principal = await resolveDevicePrincipal(request, 'login');
  if (!principal || principal.via !== 'login') {
    return NextResponse.json(
      { error: 'Your sign-in has expired. Enter your password again.', code: 'expired' },
      { status: 401 },
    );
  }
  const { user, method } = principal;

  try {
    const config = requireWebAuthnConfig(request);
    const device = await finishDeviceVerification(
      config,
      user.id,
      parsed.data.response as unknown as AuthenticationResponseJSON,
    );

    const { session, token } = await createSession({
      userId: user.id,
      email: user.email,
      sessionVersion: user.sessionVersion,
      ipAddress: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
      deviceId: device.id,
    });

    await recordAuditEvent({
      action: 'auth.login.succeeded',
      entityType: 'session',
      entityId: session.id,
      actorUserId: user.id,
      targetUserId: user.id,
      metadata: { method, deviceId: device.id, device: device.label },
      request,
    });

    const response = NextResponse.json({ success: true });
    response.cookies.set(getSessionCookieOptions(token));
    response.cookies.set(getClearedDeviceGateCookieOptions());
    return response;
  } catch (error) {
    if (error instanceof DeviceCheckError) {
      await recordAuditEvent({
        action: 'auth.login.failed',
        entityType: 'session',
        actorUserId: user.id,
        targetUserId: user.id,
        metadata: { reason: `device-${error.code}`, method },
        request,
      });
      return deviceErrorResponse(error);
    }
    throw error;
  }
}
