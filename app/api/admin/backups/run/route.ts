import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { backupOverview } from '@/lib/backup/overview';
import { backupAdminRequest, errorResponse } from '@/lib/backup/route-helpers';
import { startBackup } from '@/lib/backup/run';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

/** "Back up now": starts in the background; the page polls for progress. */
export async function POST(request: NextRequest) {
  const { auth, response } = await backupAdminRequest(request, 'run', 5);
  if (response || !auth) return response;

  try {
    const run = await startBackup('manual', auth.user.id);
    await recordAuditEvent({
      action: 'admin.backups.started',
      entityType: 'backup',
      entityId: String(run.id),
      actorUserId: auth.user.id,
      request,
    });
    return NextResponse.json(await backupOverview(), { status: 202 });
  } catch (error) {
    return errorResponse(error, 'Could not start the backup.', 409);
  }
}
