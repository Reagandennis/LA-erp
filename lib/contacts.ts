import 'server-only';

import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';

/**
 * Who may see a contact. The directory is shared, with one exception: a
 * contact someone synced from their Google account is theirs alone, since it
 * is their personal address book. Nobody else sees it, admins included.
 *
 * Every read and write of a contact goes through this, so a contact that is
 * not the viewer's behaves exactly as if it did not exist.
 */
export function contactVisibleTo(userId: number): Prisma.ContactWhereInput {
  return { OR: [{ source: { not: 'google' } }, { createdById: userId }] };
}

/** The same rule for a row already loaded. */
export function isContactVisibleTo(contact: { source: string; createdById: number }, userId: number): boolean {
  return contact.source !== 'google' || contact.createdById === userId;
}

export const CONTACT_CATEGORIES = ['Internal', 'Client', 'Vendor', 'Partner'] as const;
export type ContactCategory = (typeof CONTACT_CATEGORIES)[number];

function pickCategory(value: unknown): ContactCategory {
  return (CONTACT_CATEGORIES as readonly string[]).includes(value as string)
    ? (value as ContactCategory)
    : 'Client';
}

function trimOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return v.length > 0 ? v : null;
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const t = raw.trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out.slice(0, 20);
}

// --- Serialized shape ------------------------------------------------------

export type ContactSummary = {
  id: number;
  name: string;
  role: string | null;
  category: string;
  email: string | null;
  phone: string | null;
  location: string | null;
  notes: string | null;
  tags: string[];
  hasPhoto: boolean;
  customer: { id: number; name: string; company: string | null } | null;
  /** Synced from the viewer's own Google account: only they can see it. */
  private: boolean;
  createdAt: string;
};

const CONTACT_SELECT = {
  id: true,
  name: true,
  role: true,
  category: true,
  email: true,
  phone: true,
  location: true,
  notes: true,
  tags: true,
  photoName: true,
  source: true,
  createdAt: true,
  customer: { select: { id: true, name: true, company: true } },
} as const;

type ContactRow = {
  id: number;
  name: string;
  role: string | null;
  category: string;
  email: string | null;
  phone: string | null;
  location: string | null;
  notes: string | null;
  tags: string[];
  photoName: string | null;
  source: string;
  createdAt: Date;
  customer: { id: number; name: string; company: string | null } | null;
};

function serializeContact(row: ContactRow): ContactSummary {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    category: row.category,
    email: row.email,
    phone: row.phone,
    location: row.location,
    notes: row.notes,
    tags: row.tags ?? [],
    hasPhoto: Boolean(row.photoName),
    customer: row.customer,
    private: row.source === 'google',
    createdAt: row.createdAt.toISOString(),
  };
}

// --- Reads -----------------------------------------------------------------

/** The directory as this user sees it: the shared contacts, plus their own Google ones. */
export async function listContacts(viewerId: number): Promise<ContactSummary[]> {
  const rows = await prisma.contact.findMany({
    where: contactVisibleTo(viewerId),
    orderBy: [{ name: 'asc' }],
    select: CONTACT_SELECT,
  });
  return rows.map(serializeContact);
}

export type CustomerOption = { id: number; name: string; company: string | null };

export async function listCustomerOptions(): Promise<CustomerOption[]> {
  const rows = await prisma.customer.findMany({
    orderBy: [{ name: 'asc' }],
    select: { id: true, name: true, company: true },
  });
  return rows;
}

// --- Writes ----------------------------------------------------------------

export type PhotoInput = { name: string; mime: string; size: number; content: Buffer };

function photoData(photo: PhotoInput | null | undefined) {
  return photo
    ? { photoName: photo.name, photoMime: photo.mime, photoSize: photo.size, photoContent: photo.content }
    : {};
}

async function resolveCustomerId(customerId: unknown): Promise<number | null> {
  if (customerId == null) return null;
  const id = Number(customerId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const exists = await prisma.customer.findUnique({ where: { id }, select: { id: true } });
  return exists ? id : null;
}

export async function createContact(input: {
  userId: number;
  name: string;
  role?: string | null;
  category?: string;
  email?: string | null;
  phone?: string | null;
  location?: string | null;
  notes?: string | null;
  tags?: unknown;
  customerId?: number | null;
  photo?: PhotoInput | null;
}): Promise<ContactSummary> {
  const name = input.name.trim();
  if (!name) throw new Error('Name is required');
  const row = await prisma.contact.create({
    data: {
      name,
      role: trimOrNull(input.role),
      category: pickCategory(input.category),
      email: trimOrNull(input.email),
      phone: trimOrNull(input.phone),
      location: trimOrNull(input.location),
      notes: trimOrNull(input.notes),
      tags: normalizeTags(input.tags),
      customerId: await resolveCustomerId(input.customerId),
      createdById: input.userId,
      ...photoData(input.photo),
    },
    select: CONTACT_SELECT,
  });
  return serializeContact(row);
}

export async function updateContact(
  id: number,
  patch: {
    name?: string;
    role?: string | null;
    category?: string;
    email?: string | null;
    phone?: string | null;
    location?: string | null;
    notes?: string | null;
    tags?: unknown;
    customerId?: number | null;
  },
  viewerId: number,
): Promise<ContactSummary | null> {
  const existing = await prisma.contact.findFirst({ where: { id, ...contactVisibleTo(viewerId) }, select: { id: true } });
  if (!existing) return null;

  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const v = patch.name.trim();
    if (v) data.name = v;
  }
  if (patch.role !== undefined) data.role = trimOrNull(patch.role);
  if (patch.category !== undefined) data.category = pickCategory(patch.category);
  if (patch.email !== undefined) data.email = trimOrNull(patch.email);
  if (patch.phone !== undefined) data.phone = trimOrNull(patch.phone);
  if (patch.location !== undefined) data.location = trimOrNull(patch.location);
  if (patch.notes !== undefined) data.notes = trimOrNull(patch.notes);
  if (patch.tags !== undefined) data.tags = normalizeTags(patch.tags);
  if (patch.customerId !== undefined) data.customerId = await resolveCustomerId(patch.customerId);

  const row = await prisma.contact.update({ where: { id }, data, select: CONTACT_SELECT });
  return serializeContact(row);
}

export async function deleteContact(id: number, viewerId: number): Promise<boolean> {
  const existing = await prisma.contact.findFirst({ where: { id, ...contactVisibleTo(viewerId) }, select: { id: true } });
  if (!existing) return false;
  await prisma.contact.delete({ where: { id } });
  return true;
}

// --- Photo -----------------------------------------------------------------

export async function getContactPhoto(
  id: number,
  viewerId: number,
): Promise<{ name: string; mime: string; content: Buffer } | null> {
  const row = await prisma.contact.findFirst({
    where: { id, ...contactVisibleTo(viewerId) },
    select: { photoName: true, photoMime: true, photoContent: true },
  });
  if (!row || !row.photoContent || !row.photoMime) return null;
  return {
    name: row.photoName ?? 'photo',
    mime: row.photoMime,
    content: Buffer.from(row.photoContent),
  };
}

export async function setContactPhoto(id: number, photo: PhotoInput, viewerId: number): Promise<boolean> {
  const existing = await prisma.contact.findFirst({ where: { id, ...contactVisibleTo(viewerId) }, select: { id: true } });
  if (!existing) return false;
  await prisma.contact.update({
    where: { id },
    data: {
      photoName: photo.name,
      photoMime: photo.mime,
      photoSize: photo.size,
      photoContent: photo.content,
    },
  });
  return true;
}
