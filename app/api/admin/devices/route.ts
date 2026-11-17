import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { recordAuditEvent } from '@/lib/audit';
import { enforceRateLimit } from '@/lib/rate-limit';
import { requireAdminRequest } from '@/lib/request-auth';
import { approveDevice, deleteDevice, getDevice, listDevices, revokeDevice } from '@/lib/work-devices';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Registered work devices across all users.
 *
 * GET                          every device, pending first
 * PATCH  { id, action }        approve or revoke one
 * DELETE ?id=<device>          forget one (it must be registered again)
 */
async function guardMutation(request: NextRequest) {
  const result = await requireAdminRequest(request);
  if (result.response || !result.auth) return result;

  const rateLimit = await enforceRateLimit({
    scope: 'admin.device.mutate',
    key: `${result.auth.user.id}`,
    limit: 60,
    windowMs: 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return {
      auth: null,
      response: NextResponse.json(
        { error: 'Too many changes. Slow down and try again.', retryAfterSeconds: rateLimit.retryAfterSeconds },
        { status: 429 },
      ),
    };
  }
  return result;
}

export async function GET(request: NextRequest) {
  const { auth, response } = await requireAdminRequest(request);
  if (response || !auth) return response;
  return NextResponse.json({ devices: await listDevices(auth.deviceId) });
}

const patchSchema = z.object({
  id: z.string().min(1),
  action: z.enum(['approve', 'revoke']),
});

export async function PATCH(request: NextRequest) {
  const { auth, response } = await guardMutation(request);
  if (response || !auth) return response;

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  const { id, action } = parsed.data;

  const device = await getDevice(id);
  if (!device) return NextResponse.json({ error: 'Device not found' }, { status: 404 });

  if (action === 'revoke') {
    if (device.id === auth.deviceId) {
      return NextResponse.json({ error: 'This is the device you are signed in on. Revoke it from another approved device.' }, { status: 400 });
    }
    await revokeDevice(id);
  } else {
    await approveDevice(id, auth.user.id);
  }

  await recordAuditEvent({
    action: action === 'approve' ? 'admin.device.approved' : 'admin.device.revoked',
    entityType: 'device',
    entityId: device.id,
    actorUserId: auth.user.id,
    targetUserId: device.userId,
    metadata: { label: device.label },
    request,
  });

  return NextResponse.json({ success: true, devices: await listDevices(auth.deviceId) });
}

export async function DELETE(request: NextRequest) {
  const { auth, response } = await guardMutation(request);
  if (response || !auth) return response;

  const id = (new URL(request.url).searchParams.get('id') ?? '').trim();
  if (!id) return NextResponse.json({ error: 'Pass a device id' }, { status: 400 });

  const device = await getDevice(id);
  if (!device) return NextResponse.json({ error: 'Device not found' }, { status: 404 });
  if (device.id === auth.deviceId) {
    return NextResponse.json({ error: 'This is the device you are signed in on. Remove it from another approved device.' }, { status: 400 });
  }

  await deleteDevice(id);
  await recordAuditEvent({
    action: 'admin.device.removed',
    entityType: 'device',
    entityId: device.id,
    actorUserId: auth.user.id,
    targetUserId: device.userId,
    metadata: { label: device.label, status: device.status },
    request,
  });

  return NextResponse.json({ success: true, devices: await listDevices(auth.deviceId) });
}
