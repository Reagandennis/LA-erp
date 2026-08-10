import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireRequestAuth } from '@/lib/request-auth';
import { userHasModule, userHasRole } from '@/lib/user';
import { disconnectWave, getWaveStatus } from '@/lib/wave';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  return NextResponse.json(await getWaveStatus());
}

/** Disconnect the Wave account. */
export async function DELETE(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;
  if (!userHasRole(auth.user, ADMIN_ROLE_NAME) && !userHasModule(auth.user, 'invoices-review')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await disconnectWave();
  await recordAuditEvent({
    action: 'wave.disconnected',
    entityType: 'integration',
    entityId: 'wave',
    actorUserId: auth.user.id,
    request,
  });
  return NextResponse.json(await getWaveStatus());
}
