import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { backupOverview } from '@/lib/backup/overview';
import { backupAdminRequest } from '@/lib/backup/route-helpers';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

/** Pin a snapshot ("keep forever") so retention never removes it, or unpin it. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { auth, response } = await backupAdminRequest(request, 'pin', 30);
  if (response || !auth) return response;

  const runId = Number((await params).runId);
  const body = (await request.json().catch(() => null)) as { pinned?: unknown } | null;
  if (!Number.isSafeInteger(runId) || typeof body?.pinned !== 'boolean') {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }
  const run = await prisma.backupRun.findUnique({ where: { id: runId } });
  if (!run || run.prunedAt || (run.status !== 'success' && run.status !== 'partial')) {
    return NextResponse.json({ error: 'Only an existing snapshot can be kept.' }, { status: 404 });
  }

  await prisma.backupRun.update({ where: { id: runId }, data: { pinned: body.pinned } });
  await recordAuditEvent({
    action: body.pinned ? 'admin.backups.pinned' : 'admin.backups.unpinned',
    entityType: 'backup',
    entityId: String(runId),
    actorUserId: auth.user.id,
    request,
  });
  return NextResponse.json(await backupOverview());
}
