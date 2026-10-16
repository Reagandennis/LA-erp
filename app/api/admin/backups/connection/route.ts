import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { backupOverview } from '@/lib/backup/overview';
import { backupAdminRequest, errorResponse } from '@/lib/backup/route-helpers';
import { connectDrive, disconnectDrive } from '@/lib/backup/settings';
import { backupConnectionSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

/**
 * Connect (or re-point) Google Drive: validates the key, finds the Shared
 * Drive, and proves the service account can write there before saving.
 */
export async function PUT(request: NextRequest) {
  const { auth, response } = await backupAdminRequest(request, 'connection', 10);
  if (response || !auth) return response;

  const validation = backupConnectionSchema.safeParse(await request.json().catch(() => null));
  if (!validation.success) {
    return NextResponse.json({ error: validation.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  try {
    const saved = await connectDrive(validation.data, auth.user.id);
    await recordAuditEvent({
      action: 'admin.backups.drive_connected',
      entityType: 'settings',
      entityId: 'backups',
      actorUserId: auth.user.id,
      metadata: { driveId: saved.driveId, driveName: saved.driveName, folderId: saved.folderId, newKey: Boolean(validation.data.serviceAccountJson) },
      request,
    });
    return NextResponse.json(await backupOverview());
  } catch (error) {
    return errorResponse(error, 'Could not connect to Google Drive.');
  }
}

/** Forget the Drive credentials (existing backups and the key stay). */
export async function DELETE(request: NextRequest) {
  const { auth, response } = await backupAdminRequest(request, 'connection', 10);
  if (response || !auth) return response;

  await disconnectDrive(auth.user.id);
  await recordAuditEvent({
    action: 'admin.backups.drive_disconnected',
    entityType: 'settings',
    entityId: 'backups',
    actorUserId: auth.user.id,
    request,
  });
  return NextResponse.json(await backupOverview());
}
