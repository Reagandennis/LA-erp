import 'server-only';

import type { BackupSettings } from '@prisma/client';

import { prisma } from '../prisma';
import { generateKey, keyFingerprint } from './crypto';
import { DriveClient, DriveError, driveIdFromLink, FOLDER_MIME, parseServiceAccount } from './drive';

/** Folder created at the top of a Shared Drive when the link points at the drive itself. */
export const ROOT_FOLDER_NAME = 'LA-ERP backups';

export async function getBackupSettings(): Promise<BackupSettings> {
  return prisma.backupSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
}

export function isConnected(settings: BackupSettings): boolean {
  return Boolean(settings.serviceAccountJson && settings.driveId && settings.folderId);
}

export function driveClientFor(settings: BackupSettings): DriveClient {
  if (!settings.serviceAccountJson) throw new DriveError('Google Drive is not connected.');
  return new DriveClient(parseServiceAccount(settings.serviceAccountJson));
}

/** Everything the admin page may see: no key material, no credentials. */
export function publicSettings(settings: BackupSettings) {
  let serviceAccountEmail: string | null = null;
  try {
    serviceAccountEmail = settings.serviceAccountJson ? parseServiceAccount(settings.serviceAccountJson).clientEmail : null;
  } catch {
    serviceAccountEmail = null;
  }
  return {
    enabled: settings.enabled,
    connected: isConnected(settings),
    serviceAccountEmail,
    driveId: settings.driveId,
    driveName: settings.driveName,
    folderId: settings.folderId,
    folderUrl: settings.folderId ? `https://drive.google.com/drive/folders/${settings.folderId}` : null,
    scheduleTime: settings.scheduleTime,
    timezone: settings.timezone,
    keepDaily: settings.keepDaily,
    keepWeekly: settings.keepWeekly,
    keepMonthly: settings.keepMonthly,
    includeDatabase: settings.includeDatabase,
    includeWhatsapp: settings.includeWhatsapp,
    includeWhatsappMedia: settings.includeWhatsappMedia,
    includeSignal: settings.includeSignal,
    includeMediaCache: settings.includeMediaCache,
    includeConfig: settings.includeConfig,
    lockMonthly: settings.lockMonthly,
    alertEmails: settings.alertEmails,
    keyFingerprint: settings.encryptionKey ? keyFingerprint(settings.encryptionKey) : null,
    updatedAt: settings.updatedAt.toISOString(),
  };
}

export type PublicBackupSettings = ReturnType<typeof publicSettings>;

/**
 * Work out where backups go from a Drive link, and prove the service account
 * can write there. A link to a Shared Drive itself gets an "LA-ERP backups"
 * folder at its top; a link to a folder inside one is used as it is.
 */
export async function resolveDestination(
  client: DriveClient,
  link: string,
): Promise<{ driveId: string; driveName: string; folderId: string }> {
  const id = driveIdFromLink(link);
  if (!id) throw new DriveError('Paste the link to a Shared Drive, or to a folder inside one.');

  const shareHint = `Add ${client.clientEmail} to the Shared Drive as a Content manager, then try again.`;
  let driveId: string;
  let folderId: string;

  const drive = await client.getSharedDrive(id).catch((error: DriveError) => {
    if (error.status === 404 || error.status === 403) return null;
    throw error;
  });
  if (drive) {
    driveId = drive.id;
    const existing = await client.findChild(drive.id, ROOT_FOLDER_NAME, FOLDER_MIME);
    folderId = existing?.id ?? (await client.createFolder(ROOT_FOLDER_NAME, drive.id)).id;
  } else {
    const folder = await client.getFile(id).catch((error: DriveError) => {
      if (error.status === 404 || error.status === 403) throw new DriveError(`Can't open that link. ${shareHint}`, error.status);
      throw error;
    });
    if (folder.mimeType !== FOLDER_MIME) throw new DriveError('That link is to a file. Use a Shared Drive or a folder.');
    if (!folder.driveId) {
      throw new DriveError(
        'That folder is in someone’s My Drive. Service accounts have no storage of their own, so backups must go to a Shared Drive.',
      );
    }
    driveId = folder.driveId;
    folderId = folder.id;
  }

  // Prove write access with a throwaway file, then move it to the trash.
  const probe = await client.uploadSmall('.la-erp-write-test', folderId, `Write test ${new Date().toISOString()}`, {
    mimeType: 'text/plain',
  });
  await client.trash(probe.id);

  const driveName = drive?.name ?? (await client.getSharedDrive(driveId).then((d) => d.name).catch(() => 'Shared Drive'));
  return { driveId, driveName, folderId };
}

/** Save a new connection; creates the encryption key on first use. */
export async function connectDrive(input: { serviceAccountJson?: string; driveLink: string }, userId: number) {
  const current = await getBackupSettings();
  const serviceAccountJson = input.serviceAccountJson?.trim() || current.serviceAccountJson;
  if (!serviceAccountJson) throw new DriveError('Upload the service account key file first.');

  const client = new DriveClient(parseServiceAccount(serviceAccountJson));
  const destination = await resolveDestination(client, input.driveLink);

  return prisma.backupSettings.update({
    where: { id: 1 },
    data: {
      serviceAccountJson,
      ...destination,
      encryptionKey: current.encryptionKey ?? generateKey(),
      updatedById: userId,
    },
  });
}

export async function disconnectDrive(userId: number) {
  // The key stays: existing backups still need it to be restored.
  return prisma.backupSettings.update({
    where: { id: 1 },
    data: { serviceAccountJson: null, driveId: null, driveName: null, folderId: null, enabled: false, updatedById: userId },
  });
}
