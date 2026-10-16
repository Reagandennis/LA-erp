import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { backupOverview } from '@/lib/backup/overview';
import { isValidTimeZone } from '@/lib/backup/policy';
import { backupAdminRequest } from '@/lib/backup/route-helpers';
import { getBackupSettings, isConnected, publicSettings } from '@/lib/backup/settings';
import { prisma } from '@/lib/prisma';
import { backupSettingsUpdateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

/** Settings (no secrets), recent runs and schedule — the backups page's data. */
export async function GET(request: NextRequest) {
  const { auth, response } = await backupAdminRequest(request, 'read', 120);
  if (response || !auth) return response;
  return NextResponse.json(await backupOverview());
}

/** Schedule, retention, what to include, alerts. */
export async function PUT(request: NextRequest) {
  const { auth, response } = await backupAdminRequest(request, 'settings', 10);
  if (response || !auth) return response;

  const validation = backupSettingsUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!validation.success) {
    return NextResponse.json({ error: validation.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }
  const input = validation.data;
  if (!isValidTimeZone(input.timezone)) return NextResponse.json({ error: 'Unknown time zone.' }, { status: 400 });

  const before = await getBackupSettings();
  if (input.enabled && !isConnected(before)) {
    return NextResponse.json({ error: 'Connect Google Drive before turning on scheduled backups.' }, { status: 400 });
  }
  const after = await prisma.backupSettings.update({ where: { id: 1 }, data: { ...input, updatedById: auth.user.id } });

  await recordAuditEvent({
    action: 'admin.backups.settings_updated',
    entityType: 'settings',
    entityId: 'backups',
    actorUserId: auth.user.id,
    metadata: { before: publicSettings(before), after: publicSettings(after) },
    request,
  });
  return NextResponse.json(await backupOverview());
}
