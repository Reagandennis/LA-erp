import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { keyFingerprint } from '@/lib/backup/crypto';
import { backupAdminRequest } from '@/lib/backup/route-helpers';
import { getBackupSettings } from '@/lib/backup/settings';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

/**
 * Reveal the recovery key, for an admin to store in a password manager.
 * Without it no backup can be restored — including after losing this server,
 * when the copy in the database is gone too. Every reveal is audited.
 */
export async function POST(request: NextRequest) {
  const { auth, response } = await backupAdminRequest(request, 'key', 5);
  if (response || !auth) return response;

  const settings = await getBackupSettings();
  if (!settings.encryptionKey) return NextResponse.json({ error: 'No key yet: connect Google Drive first.' }, { status: 404 });

  await recordAuditEvent({
    action: 'admin.backups.key_revealed',
    entityType: 'settings',
    entityId: 'backups',
    actorUserId: auth.user.id,
    metadata: { keyFingerprint: keyFingerprint(settings.encryptionKey) },
    request,
  });
  return NextResponse.json(
    { key: settings.encryptionKey, fingerprint: keyFingerprint(settings.encryptionKey) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
