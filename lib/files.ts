import 'server-only';

import { notifyNotificationsChanged } from '@/lib/notification-events';
import { prisma } from '@/lib/prisma';

export type ShareTarget = { id: number; name: string };

export type StoredFileSummary = {
  id: number;
  name: string;
  description: string | null;
  tags: string[];
  mimeType: string;
  size: number;
  uploadedBy: { id: number; name: string };
  isOwner: boolean;
  sharedWith: ShareTarget[];
  createdAt: string;
};

export type StoredFileStats = {
  total: number;
  totalSize: number;
  images: number;
  documents: number;
  sharedWithMe: number;
};

const SUMMARY_SELECT = {
  id: true,
  name: true,
  description: true,
  tags: true,
  mimeType: true,
  size: true,
  createdAt: true,
  uploadedById: true,
  uploadedBy: { select: { id: true, name: true } },
  shares: { select: { user: { select: { id: true, name: true } } } },
} as const;

type SummaryRow = {
  id: number;
  name: string;
  description: string | null;
  tags: string[];
  mimeType: string;
  size: number;
  createdAt: Date;
  uploadedById: number;
  uploadedBy: { id: number; name: string };
  shares: Array<{ user: { id: number; name: string } }>;
};

function serialize(row: SummaryRow, viewerId: number): StoredFileSummary {
  const isOwner = row.uploadedById === viewerId;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    tags: row.tags,
    mimeType: row.mimeType,
    size: row.size,
    uploadedBy: { id: row.uploadedBy.id, name: row.uploadedBy.name },
    isOwner,
    // Only the owner needs to see the full recipient list.
    sharedWith: isOwner ? row.shares.map((s) => ({ id: s.user.id, name: s.user.name })) : [],
    createdAt: row.createdAt.toISOString(),
  };
}

function isDocumentMime(mime: string): boolean {
  return (
    mime === 'application/pdf' ||
    mime.startsWith('text/') ||
    mime.includes('word') ||
    mime.includes('excel') ||
    mime.includes('spreadsheet') ||
    mime.includes('presentation') ||
    mime.includes('document')
  );
}

/** Files the user uploaded, plus files explicitly shared with them. Newest first. */
export async function listFiles(userId: number): Promise<StoredFileSummary[]> {
  const rows = await prisma.storedFile.findMany({
    where: { OR: [{ uploadedById: userId }, { shares: { some: { userId } } }] },
    orderBy: [{ createdAt: 'desc' }],
    select: SUMMARY_SELECT,
  });
  return rows.map((r) => serialize(r, userId));
}

export function computeStats(items: StoredFileSummary[]): StoredFileStats {
  return {
    total: items.length,
    totalSize: items.reduce((sum, f) => sum + f.size, 0),
    images: items.filter((f) => f.mimeType.startsWith('image/')).length,
    documents: items.filter((f) => isDocumentMime(f.mimeType)).length,
    sharedWithMe: items.filter((f) => !f.isOwner).length,
  };
}

/** Active users the current user can share with. */
export async function listShareableUsers(userId: number): Promise<ShareTarget[]> {
  const users = await prisma.user.findMany({
    where: { status: 'active', id: { not: userId } },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  return users;
}

export async function createFiles(
  userId: number,
  files: Array<{ name: string; mime: string; size: number; content: Buffer }>,
): Promise<StoredFileSummary[]> {
  const created: StoredFileSummary[] = [];
  for (const file of files) {
    const row = await prisma.storedFile.create({
      data: {
        name: file.name || 'untitled',
        mimeType: file.mime || 'application/octet-stream',
        size: file.size,
        content: file.content,
        uploadedById: userId,
      },
      select: SUMMARY_SELECT,
    });
    created.push(serialize(row, userId));
  }
  return created;
}

/** Returns file content only if the user owns it or it was shared with them. */
export async function getFileContent(
  id: number,
  userId: number,
): Promise<{ name: string; mime: string; content: Buffer } | null> {
  const row = await prisma.storedFile.findUnique({
    where: { id },
    select: {
      name: true,
      mimeType: true,
      content: true,
      uploadedById: true,
      shares: { where: { userId }, select: { id: true } },
    },
  });
  if (!row) return null;
  const hasAccess = row.uploadedById === userId || row.shares.length > 0;
  if (!hasAccess) return null;
  return { name: row.name, mime: row.mimeType, content: Buffer.from(row.content) };
}

export type WriteResult =
  | { status: 'ok'; file: StoredFileSummary }
  | { status: 'not_found' }
  | { status: 'forbidden' };

/** Only the uploader may modify a file. */
async function ensureOwner(id: number, userId: number) {
  const row = await prisma.storedFile.findUnique({ where: { id }, select: { uploadedById: true } });
  if (!row) return 'not_found' as const;
  if (row.uploadedById !== userId) return 'forbidden' as const;
  return 'ok' as const;
}

const MAX_TAGS_PER_FILE = 12;
const MAX_TAG_LENGTH = 32;

/** Trim, collapse whitespace, drop empties, dedupe case-insensitively, cap count. */
function normalizeTags(raw: string[]): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const value of raw) {
    const tag = value.trim().replace(/\s+/g, ' ').slice(0, MAX_TAG_LENGTH);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= MAX_TAGS_PER_FILE) break;
  }
  return tags;
}

export async function updateFile(
  id: number,
  userId: number,
  patch: { name?: string; description?: string | null; tags?: string[] },
): Promise<WriteResult> {
  const permission = await ensureOwner(id, userId);
  if (permission !== 'ok') return { status: permission };

  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (name) data.name = name;
  }
  if (patch.description !== undefined) data.description = patch.description?.trim() || null;
  if (patch.tags !== undefined) data.tags = normalizeTags(patch.tags);

  const row = await prisma.storedFile.update({ where: { id }, data, select: SUMMARY_SELECT });
  return { status: 'ok', file: serialize(row, userId) };
}

export async function deleteFile(
  id: number,
  userId: number,
): Promise<'ok' | 'not_found' | 'forbidden'> {
  const permission = await ensureOwner(id, userId);
  if (permission !== 'ok') return permission;
  await prisma.storedFile.delete({ where: { id } });
  return 'ok';
}

/**
 * Share a file with other users. Notifies each new recipient AND the owner.
 * Returns the updated file summary, or a permission status.
 */
export async function shareFile(
  id: number,
  ownerId: number,
  recipientIds: number[],
): Promise<WriteResult> {
  const file = await prisma.storedFile.findUnique({
    where: { id },
    select: { id: true, name: true, uploadedById: true },
  });
  if (!file) return { status: 'not_found' };
  if (file.uploadedById !== ownerId) return { status: 'forbidden' };

  const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { name: true } });
  const ownerName = owner?.name ?? 'Someone';

  const cleanIds = Array.from(new Set(recipientIds.filter((rid) => Number.isInteger(rid) && rid > 0 && rid !== ownerId)));

  // Keep only valid, active recipients not already shared with.
  const validUsers = await prisma.user.findMany({
    where: { id: { in: cleanIds }, status: 'active' },
    select: { id: true, name: true },
  });
  const existingShares = await prisma.storedFileShare.findMany({
    where: { fileId: id, userId: { in: validUsers.map((u) => u.id) } },
    select: { userId: true },
  });
  const alreadyShared = new Set(existingShares.map((s) => s.userId));
  const newRecipients = validUsers.filter((u) => !alreadyShared.has(u.id));

  if (newRecipients.length > 0) {
    await prisma.storedFileShare.createMany({
      data: newRecipients.map((u) => ({ fileId: id, userId: u.id })),
      skipDuplicates: true,
    });

    const notifications: Array<{ userId: number; fileId: number; type: string; message: string }> = [];
    for (const recipient of newRecipients) {
      // Notify the receiver.
      notifications.push({
        userId: recipient.id,
        fileId: id,
        type: 'file.shared.received',
        message: `${ownerName} shared "${file.name}" with you`,
      });
      // Notify the sender (owner) too.
      notifications.push({
        userId: ownerId,
        fileId: id,
        type: 'file.shared.sent',
        message: `You shared "${file.name}" with ${recipient.name}`,
      });
    }
    await prisma.fileNotification.createMany({ data: notifications });
    notifyNotificationsChanged(notifications.map((n) => n.userId));
  }

  const row = await prisma.storedFile.findUnique({ where: { id }, select: SUMMARY_SELECT });
  if (!row) return { status: 'not_found' };
  return { status: 'ok', file: serialize(row, ownerId) };
}

export async function unshareFile(
  id: number,
  ownerId: number,
  recipientId: number,
): Promise<WriteResult> {
  const permission = await ensureOwner(id, ownerId);
  if (permission !== 'ok') return { status: permission };

  await prisma.storedFileShare.deleteMany({ where: { fileId: id, userId: recipientId } });

  const row = await prisma.storedFile.findUnique({ where: { id }, select: SUMMARY_SELECT });
  if (!row) return { status: 'not_found' };
  return { status: 'ok', file: serialize(row, ownerId) };
}

type FileNotificationRow = {
  id: number;
  fileId: number;
  type: string;
  message: string;
  createdAt: Date;
  readAt: Date | null;
};

export async function listFileNotifications(userId: number) {
  const rows = (await prisma.fileNotification.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { id: true, fileId: true, type: true, message: true, createdAt: true, readAt: true },
  })) as FileNotificationRow[];

  return rows.map((row) => ({
    id: row.id,
    fileId: row.fileId,
    type: row.type,
    message: row.message,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
  }));
}

export async function markFileNotificationsRead(userId: number, ids: number[]): Promise<number> {
  const normalized = Array.from(new Set(ids.filter((id) => Number.isInteger(id) && id > 0)));
  if (normalized.length === 0) return 0;
  const result = await prisma.fileNotification.updateMany({
    where: { userId, id: { in: normalized } },
    data: { readAt: new Date() },
  });
  if (result.count > 0) notifyNotificationsChanged(userId);
  return result.count;
}
