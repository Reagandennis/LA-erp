import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { backupOverview } from '@/lib/backup/overview';
import { backupAdminRequest, errorResponse } from '@/lib/backup/route-helpers';
import { verifyRun } from '@/lib/backup/run';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

/** Re-check a snapshot in Drive, and prove the current key still decrypts it. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { auth, response } = await backupAdminRequest(request, 'verify', 10);
  if (response || !auth) return response;

  const runId = Number((await params).runId);
  if (!Number.isSafeInteger(runId)) return NextResponse.json({ error: 'bad-request' }, { status: 400 });

  try {
    const result = await verifyRun(runId);
    await recordAuditEvent({
      action: 'admin.backups.verified',
      entityType: 'backup',
      entityId: String(runId),
      actorUserId: auth.user.id,
      metadata: { ok: result.ok, problems: result.problems },
      request,
    });
    return NextResponse.json({ ...result, overview: await backupOverview() });
  } catch (error) {
    return errorResponse(error, 'Could not verify the snapshot.');
  }
}
