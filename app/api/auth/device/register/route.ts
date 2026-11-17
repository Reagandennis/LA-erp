import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { recordAuditEvent } from '@/lib/audit';
import {
  DeviceCheckError,
  MAX_DEVICE_LABEL_LENGTH,
  deviceErrorResponse,
  finishDeviceRegistration,
  getClientIp,
  requireWebAuthnConfig,
  resolveDevicePrincipal,
} from '@/lib/work-devices';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  context: z.enum(['login', 'session']).default('login'),
  label: z.string().max(MAX_DEVICE_LABEL_LENGTH * 2).optional(),
  // The authenticator's answer; its contents are verified cryptographically.
  response: z.looseObject({ id: z.string().min(1), response: z.looseObject({}) }),
});

/**
 * Second half of registering a device. The device is stored as "pending": it
 * cannot be used to sign in until an administrator approves it.
 */
export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const principal = await resolveDevicePrincipal(request, parsed.data.context);
  if (!principal) {
    return NextResponse.json(
      { error: 'Your sign-in has expired. Enter your password again.', code: 'expired' },
      { status: 401 },
    );
  }

  try {
    const config = requireWebAuthnConfig(request);
    const device = await finishDeviceRegistration(config, principal.user, {
      response: parsed.data.response as unknown as RegistrationResponseJSON,
      label: parsed.data.label,
      ipAddress: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
    });

    await recordAuditEvent({
      action: 'auth.device.registered',
      entityType: 'device',
      entityId: device.id,
      actorUserId: principal.user.id,
      targetUserId: principal.user.id,
      metadata: { label: device.label, during: principal.via },
      request,
    });

    return NextResponse.json({ device: { id: device.id, label: device.label, status: device.status } });
  } catch (error) {
    if (error instanceof DeviceCheckError) {
      await recordAuditEvent({
        action: 'auth.device.rejected',
        entityType: 'device',
        actorUserId: principal.user.id,
        targetUserId: principal.user.id,
        metadata: { reason: error.code, during: principal.via },
        request,
      });
      return deviceErrorResponse(error);
    }
    throw error;
  }
}
