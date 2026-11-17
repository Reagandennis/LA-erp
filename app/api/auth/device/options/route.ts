import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { enforceRateLimit } from '@/lib/rate-limit';
import {
  DeviceCheckError,
  beginDeviceRegistration,
  beginDeviceVerification,
  deviceErrorResponse,
  requireWebAuthnConfig,
  resolveDevicePrincipal,
} from '@/lib/work-devices';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  /** verify: prove this is an approved device. register: enrol this device. */
  mode: z.enum(['verify', 'register']),
  /** login: part-way through signing in. session: already signed in. */
  context: z.enum(['login', 'session']).default('login'),
});

/**
 * First half of a device check: hands the browser the challenge its built-in
 * authenticator (Touch ID, Windows Hello) has to sign.
 */
export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  const { mode, context } = parsed.data;
  // Checking a device only happens while signing in.
  if (mode === 'verify' && context !== 'login') {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const principal = await resolveDevicePrincipal(request, context);
  if (!principal) {
    return NextResponse.json(
      { error: 'Your sign-in has expired. Enter your password again.', code: 'expired' },
      { status: 401 },
    );
  }

  const rateLimit = await enforceRateLimit({
    scope: 'auth.device',
    key: `${principal.user.id}`,
    limit: 30,
    windowMs: 15 * 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many attempts. Try again shortly.', retryAfterSeconds: rateLimit.retryAfterSeconds },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    );
  }

  try {
    const config = requireWebAuthnConfig(request);
    const options =
      mode === 'register'
        ? await beginDeviceRegistration(config, principal.user)
        : await beginDeviceVerification(config, principal.user.id);
    return NextResponse.json({ options });
  } catch (error) {
    if (error instanceof DeviceCheckError) return deviceErrorResponse(error);
    throw error;
  }
}
