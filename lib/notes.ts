import 'server-only';

import { prisma } from '@/lib/prisma';

export const NOTE_CATEGORIES = ['Personal', 'Work', 'Ideas'] as const;
export const NOTE_COLORS = ['yellow', 'blue', 'green', 'pink', 'purple', 'gray'] as const;

export type NoteCategory = (typeof NOTE_CATEGORIES)[number];
export type NoteColor = (typeof NOTE_COLORS)[number];

function pickCategory(value: unknown): NoteCategory {
  return (NOTE_CATEGORIES as readonly string[]).includes(value as string) ? (value as NoteCategory) : 'Work';
}
function pickColor(value: unknown): NoteColor {
  return (NOTE_COLORS as readonly string[]).includes(value as string) ? (value as NoteColor) : 'yellow';
}

export type NoteSummary = {
  id: number;
  title: string;
  content: string;
  category: string;
  color: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
};

const NOTE_SELECT = {
  id: true,
  title: true,
  content: true,
  category: true,
  color: true,
  pinned: true,
  createdAt: true,
  updatedAt: true,
} as const;

type NoteRow = {
  id: number;
  title: string;
  content: string;
  category: string;
  color: string;
  pinned: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function serialize(row: NoteRow): NoteSummary {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    category: row.category,
    color: row.color,
    pinned: row.pinned,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Notes belonging to one user, pinned first then most-recently updated. */
export async function listNotes(userId: number): Promise<NoteSummary[]> {
  const rows = await prisma.note.findMany({
    where: { userId },
    orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }],
    select: NOTE_SELECT,
  });
  return rows.map(serialize);
}

export async function createNote(input: {
  userId: number;
  title: string;
  content?: string;
  category?: string;
  color?: string;
  pinned?: boolean;
}): Promise<NoteSummary> {
  const title = input.title.trim();
  if (!title) throw new Error('Title is required');
  const row = await prisma.note.create({
    data: {
      userId: input.userId,
      title,
      content: typeof input.content === 'string' ? input.content : '',
      category: pickCategory(input.category),
      color: pickColor(input.color),
      pinned: Boolean(input.pinned),
    },
    select: NOTE_SELECT,
  });
  return serialize(row);
}

/** Update a note, enforcing that it belongs to the given user. */
export async function updateNote(
  id: number,
  userId: number,
  patch: { title?: string; content?: string; category?: string; color?: string; pinned?: boolean },
): Promise<NoteSummary | null> {
  const existing = await prisma.note.findUnique({ where: { id }, select: { id: true, userId: true } });
  if (!existing || existing.userId !== userId) return null;

  const data: Record<string, unknown> = {};
  if (patch.title !== undefined) {
    const v = patch.title.trim();
    if (v) data.title = v;
  }
  if (patch.content !== undefined) data.content = typeof patch.content === 'string' ? patch.content : '';
  if (patch.category !== undefined) data.category = pickCategory(patch.category);
  if (patch.color !== undefined) data.color = pickColor(patch.color);
  if (patch.pinned !== undefined) data.pinned = Boolean(patch.pinned);

  const row = await prisma.note.update({ where: { id }, data, select: NOTE_SELECT });
  return serialize(row);
}

/** Delete a note, enforcing ownership. */
export async function deleteNote(id: number, userId: number): Promise<boolean> {
  const existing = await prisma.note.findUnique({ where: { id }, select: { id: true, userId: true } });
  if (!existing || existing.userId !== userId) return false;
  await prisma.note.delete({ where: { id } });
  return true;
}
