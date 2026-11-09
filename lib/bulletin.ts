import 'server-only';

import { prisma } from '@/lib/prisma';

/**
 * The Bulletin Board: notices for the whole company.
 *
 * Anyone who holds the module can read and post. A post's author (or an
 * admin) can edit, pin and take it down. Each person's "seen" is recorded, so
 * the board can show what is new to them and the author can see who has read
 * a notice. An expired post leaves the board but is kept for the record.
 */

export const BULLETIN_CATEGORIES = ['Announcement', 'Notice', 'Safety', 'Event', 'Policy', 'Reminder'] as const;
export type BulletinCategory = (typeof BULLETIN_CATEGORIES)[number];

export const TITLE_MAX = 160;
export const BODY_MAX = 10_000;

function pickCategory(value: unknown): BulletinCategory {
  return (BULLETIN_CATEGORIES as readonly string[]).includes(value as string) ? (value as BulletinCategory) : 'Announcement';
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  // A bare date from the form means "through the end of that day".
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T23:59:59.999Z`) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// --- Serialized shapes -----------------------------------------------------

export type BulletinAuthor = { id: number; name: string };

export type BulletinPostSummary = {
  id: number;
  title: string;
  body: string;
  category: string;
  pinned: boolean;
  expiresAt: string | null;
  /** Past its expiry: off the board, shown only when asked for. */
  expired: boolean;
  createdAt: string;
  updatedAt: string;
  author: BulletinAuthor | null;
  /** How many people have seen it, and whether the caller is one of them. */
  readCount: number;
  readByMe: boolean;
};

export type BulletinReader = { id: number; name: string; readAt: string };

export type BulletinPostDetail = BulletinPostSummary & { readers: BulletinReader[] };

export type BulletinStats = {
  /** Live posts the caller has not seen. */
  unread: number;
  pinned: number;
  active: number;
  thisWeek: number;
};

type PostRow = {
  id: number;
  title: string;
  body: string;
  category: string;
  pinned: boolean;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  author: BulletinAuthor | null;
  _count: { reads: number };
  reads: Array<{ id: number }>;
};

function isExpired(expiresAt: Date | null, now: Date): boolean {
  return expiresAt !== null && expiresAt.getTime() <= now.getTime();
}

function serialize(row: PostRow, now = new Date()): BulletinPostSummary {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    category: row.category,
    pinned: row.pinned,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    expired: isExpired(row.expiresAt, now),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    author: row.author,
    readCount: row._count.reads,
    readByMe: row.reads.length > 0,
  };
}

function includeFor(userId: number) {
  return {
    author: { select: { id: true, name: true } },
    _count: { select: { reads: true } },
    reads: { where: { userId }, select: { id: true }, take: 1 },
  } as const;
}

/** Posts still on the board: not expired. */
export function liveWhere(now = new Date()) {
  return { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
}

// --- Reads -----------------------------------------------------------------

/**
 * The board as `userId` sees it: pinned first, newest first. Expired posts
 * are left out unless `includeExpired`, which the "show expired" switch asks for.
 */
export async function listPosts(userId: number, options: { includeExpired?: boolean; now?: Date } = {}): Promise<BulletinPostSummary[]> {
  const now = options.now ?? new Date();
  const rows = await prisma.bulletinPost.findMany({
    where: options.includeExpired ? {} : liveWhere(now),
    orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
    include: includeFor(userId),
  });
  return rows.map((r) => serialize(r, now));
}

export async function getPost(id: number, userId: number): Promise<BulletinPostDetail | null> {
  const row = await prisma.bulletinPost.findUnique({
    where: { id },
    include: {
      ...includeFor(userId),
      reads: { where: { userId }, select: { id: true }, take: 1 },
    },
  });
  if (!row) return null;
  const readers = await prisma.bulletinRead.findMany({
    where: { postId: id },
    orderBy: { readAt: 'asc' },
    select: { readAt: true, user: { select: { id: true, name: true } } },
  });
  return {
    ...serialize(row),
    readers: readers.map((r) => ({ id: r.user.id, name: r.user.name, readAt: r.readAt.toISOString() })),
  };
}

export function computeStats(posts: BulletinPostSummary[], now = new Date()): BulletinStats {
  const weekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const live = posts.filter((p) => !p.expired);
  return {
    unread: live.filter((p) => !p.readByMe).length,
    pinned: live.filter((p) => p.pinned).length,
    active: live.length,
    thisWeek: posts.filter((p) => new Date(p.createdAt).getTime() >= weekAgo).length,
  };
}

// --- Writes ----------------------------------------------------------------

function cleanTitle(value: unknown): string {
  const title = typeof value === 'string' ? value.trim() : '';
  if (!title) throw new Error('A title is required');
  if (title.length > TITLE_MAX) throw new Error(`Keep the title under ${TITLE_MAX} characters`);
  return title;
}

function cleanBody(value: unknown): string {
  const body = typeof value === 'string' ? value.trim() : '';
  if (!body) throw new Error('Write the notice before posting it');
  if (body.length > BODY_MAX) throw new Error(`Keep the notice under ${BODY_MAX.toLocaleString()} characters`);
  return body;
}

export async function createPost(input: {
  userId: number;
  title: string;
  body: string;
  category?: string;
  pinned?: boolean;
  expiresAt?: string | null;
}): Promise<BulletinPostSummary> {
  const row = await prisma.bulletinPost.create({
    data: {
      title: cleanTitle(input.title),
      body: cleanBody(input.body),
      category: pickCategory(input.category),
      pinned: Boolean(input.pinned),
      expiresAt: parseDate(input.expiresAt),
      authorId: input.userId,
      // Writing a notice is reading it.
      reads: { create: { userId: input.userId } },
    },
    include: includeFor(input.userId),
  });
  return serialize(row);
}

export async function updatePost(
  id: number,
  userId: number,
  patch: { title?: string; body?: string; category?: string; pinned?: boolean; expiresAt?: string | null },
): Promise<BulletinPostSummary | null> {
  const existing = await prisma.bulletinPost.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return null;
  const data: Record<string, unknown> = {};
  if (patch.title !== undefined) data.title = cleanTitle(patch.title);
  if (patch.body !== undefined) data.body = cleanBody(patch.body);
  if (patch.category !== undefined) data.category = pickCategory(patch.category);
  if (patch.pinned !== undefined) data.pinned = Boolean(patch.pinned);
  if (patch.expiresAt !== undefined) data.expiresAt = parseDate(patch.expiresAt);
  const row = await prisma.bulletinPost.update({ where: { id }, data, include: includeFor(userId) });
  return serialize(row);
}

export async function deletePost(id: number): Promise<boolean> {
  const existing = await prisma.bulletinPost.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return false;
  await prisma.bulletinPost.delete({ where: { id } });
  return true;
}

/** Record that `userId` has seen the post. Seeing it twice changes nothing. */
export async function markRead(id: number, userId: number): Promise<BulletinPostSummary | null> {
  const existing = await prisma.bulletinPost.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return null;
  await prisma.bulletinRead.upsert({
    where: { postId_userId: { postId: id, userId } },
    create: { postId: id, userId },
    update: {},
  });
  const row = await prisma.bulletinPost.findUnique({ where: { id }, include: includeFor(userId) });
  return row ? serialize(row) : null;
}

/** True when the user wrote the post, null when there is no such post. Admins are checked by the route. */
export async function isAuthor(id: number, userId: number): Promise<boolean | null> {
  const row = await prisma.bulletinPost.findUnique({ where: { id }, select: { authorId: true } });
  if (!row) return null;
  return row.authorId === userId;
}
