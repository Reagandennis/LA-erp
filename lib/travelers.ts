import 'server-only';

import { prisma } from '@/lib/prisma';
import {
  RISK_LEVELS,
  TRAVELER_STATUSES,
  type RiskLevel,
  type TravelerStatus,
} from '@/lib/traveler-options';

export { RISK_LEVELS, TRAVELER_STATUSES };
export type { RiskLevel, TravelerStatus };

/**
 * Travellers are the people we protect (principals / protectees), as opposed to
 * Personnel, who are the people we assign to work. They belong to a client
 * account rather than to us, and they carry sensitive PII — which is why this
 * lives behind its own `travelers` module grant.
 */


function pickStatus(value: unknown): TravelerStatus {
  return (TRAVELER_STATUSES as readonly string[]).includes(value as string)
    ? (value as TravelerStatus)
    : 'Active';
}
function pickRiskLevel(value: unknown): RiskLevel {
  return (RISK_LEVELS as readonly string[]).includes(value as string) ? (value as RiskLevel) : 'Standard';
}
function trimOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return v.length > 0 ? v : null;
}
function parseDate(value: unknown): Date | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' && !(value instanceof Date)) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// --- Serialized shape ------------------------------------------------------

/**
 * What the directory's cards, filters and search need. Passport number, date
 * of birth, medical/dietary notes and next of kin stay on the detail record
 * (`TravelerSummary`), fetched when a card is opened: with hundreds of
 * travellers the long text was most of the list payload.
 */
export type TravelerListItem = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  nationality: string | null;
  passportExpiry: string | null;
  status: string;
  riskLevel: string;
  hasPhoto: boolean;
  customer: { id: number; name: string; company: string | null } | null;
  tripCount: number;
};

/** The full record, for the detail drawer and the edit form. */
export type TravelerSummary = TravelerListItem & {
  dateOfBirth: string | null;
  passportNumber: string | null;
  dietaryNotes: string | null;
  medicalNotes: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  notes: string | null;
  createdAt: string;
};

const LIST_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  nationality: true,
  passportExpiry: true,
  status: true,
  riskLevel: true,
  photoName: true,
  customer: { select: { id: true, name: true, company: true } },
  _count: { select: { trips: true } },
} as const;

const SELECT = {
  ...LIST_SELECT,
  dateOfBirth: true,
  passportNumber: true,
  dietaryNotes: true,
  medicalNotes: true,
  emergencyContactName: true,
  emergencyContactPhone: true,
  notes: true,
  createdAt: true,
} as const;

type TravelerListRow = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  nationality: string | null;
  passportExpiry: Date | null;
  status: string;
  riskLevel: string;
  photoName: string | null;
  customer: { id: number; name: string; company: string | null } | null;
  _count: { trips: number };
};

type TravelerRow = TravelerListRow & {
  dateOfBirth: Date | null;
  passportNumber: string | null;
  dietaryNotes: string | null;
  medicalNotes: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  notes: string | null;
  createdAt: Date;
};

function serializeListItem(row: TravelerListRow): TravelerListItem {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    nationality: row.nationality,
    passportExpiry: row.passportExpiry?.toISOString() ?? null,
    status: row.status,
    riskLevel: row.riskLevel,
    hasPhoto: Boolean(row.photoName),
    customer: row.customer,
    tripCount: row._count.trips,
  };
}

function serialize(row: TravelerRow): TravelerSummary {
  return {
    ...serializeListItem(row),
    dateOfBirth: row.dateOfBirth?.toISOString() ?? null,
    passportNumber: row.passportNumber,
    dietaryNotes: row.dietaryNotes,
    medicalNotes: row.medicalNotes,
    emergencyContactName: row.emergencyContactName,
    emergencyContactPhone: row.emergencyContactPhone,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
  };
}

// --- Reads -----------------------------------------------------------------

/** Every traveller as a list row, name order. Prefer `searchTravelers` for a screen. */
export async function listTravelers(): Promise<TravelerListItem[]> {
  const rows = await prisma.traveler.findMany({ orderBy: [{ name: 'asc' }], select: LIST_SELECT });
  return rows.map(serializeListItem);
}

export const TRAVELER_PAGE_SIZE = 60;
const MAX_PAGE_SIZE = 200;

export type TravelerSearch = {
  /** Case-insensitive match on name, email, phone, nationality, client name or company. */
  q?: string | null;
  /** A risk level, or anything else for all. */
  risk?: string | null;
  /** A status, or anything else for all. */
  status?: string | null;
  /** 1-based. */
  page?: number | null;
  pageSize?: number | null;
};

export type TravelerPage = {
  items: TravelerListItem[];
  total: number;
  page: number;
  pageSize: number;
};

function searchWhere(params: TravelerSearch) {
  const q = params.q?.trim() ?? '';
  const where: Record<string, unknown>[] = [];
  if (params.risk && (RISK_LEVELS as readonly string[]).includes(params.risk)) where.push({ riskLevel: params.risk });
  if (params.status && (TRAVELER_STATUSES as readonly string[]).includes(params.status)) {
    where.push({ status: params.status });
  }
  if (q) {
    const contains = { contains: q, mode: 'insensitive' as const };
    where.push({
      OR: [
        { name: contains },
        { email: contains },
        { phone: contains },
        { nationality: contains },
        { customer: { is: { name: contains } } },
        { customer: { is: { company: contains } } },
      ],
    });
  }
  return where.length > 0 ? { AND: where } : {};
}

/** One page of the directory, filtered and searched in the database. */
export async function searchTravelers(params: TravelerSearch = {}): Promise<TravelerPage> {
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(params.pageSize ?? TRAVELER_PAGE_SIZE)));
  const page = Math.max(1, Math.trunc(params.page ?? 1));
  const where = searchWhere(params);
  const [rows, total] = await Promise.all([
    prisma.traveler.findMany({
      where,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: LIST_SELECT,
    }),
    prisma.traveler.count({ where }),
  ]);
  return { items: rows.map(serializeListItem), total, page, pageSize };
}

export type TravelerStats = {
  total: number;
  active: number;
  /** Elevated or High risk. */
  elevatedRisk: number;
  /** Passport expired, or expiring within the next 180 days. */
  passportExpiring: number;
};

/** The directory's stat tiles, counted in the database rather than from a full list. */
export async function travelerStats(now = new Date()): Promise<TravelerStats> {
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() + 180);
  const [total, active, elevatedRisk, passportExpiring] = await Promise.all([
    prisma.traveler.count(),
    prisma.traveler.count({ where: { status: 'Active' } }),
    prisma.traveler.count({ where: { riskLevel: { not: 'Standard' } } }),
    prisma.traveler.count({ where: { passportExpiry: { lte: cutoff } } }),
  ]);
  return { total, active, elevatedRisk, passportExpiring };
}

export async function getTravelerById(id: number): Promise<TravelerSummary | null> {
  const row = await prisma.traveler.findUnique({ where: { id }, select: SELECT });
  return row ? serialize(row) : null;
}

// --- Writes ----------------------------------------------------------------

export type PhotoInput = { name: string; mime: string; size: number; content: Buffer };

function photoData(photo: PhotoInput | null | undefined) {
  return photo
    ? { photoName: photo.name, photoMime: photo.mime, photoSize: photo.size, photoContent: photo.content }
    : {};
}

/** Verify the customer exists; returns null rather than throwing, like contacts. */
async function resolveCustomerId(customerId: unknown): Promise<number | null> {
  if (customerId == null) return null;
  const id = Number(customerId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const exists = await prisma.customer.findUnique({ where: { id }, select: { id: true } });
  return exists ? id : null;
}

export async function createTraveler(input: {
  createdById: number;
  name: string;
  customerId?: number | null;
  email?: string | null;
  phone?: string | null;
  nationality?: string | null;
  dateOfBirth?: string | null;
  passportNumber?: string | null;
  passportExpiry?: string | null;
  status?: string;
  riskLevel?: string;
  dietaryNotes?: string | null;
  medicalNotes?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  notes?: string | null;
  photo?: PhotoInput | null;
}): Promise<TravelerSummary> {
  const name = input.name.trim();
  if (!name) throw new Error('Name is required');

  const row = await prisma.traveler.create({
    data: {
      name,
      customerId: await resolveCustomerId(input.customerId),
      email: trimOrNull(input.email),
      phone: trimOrNull(input.phone),
      nationality: trimOrNull(input.nationality),
      dateOfBirth: parseDate(input.dateOfBirth),
      passportNumber: trimOrNull(input.passportNumber),
      passportExpiry: parseDate(input.passportExpiry),
      status: pickStatus(input.status),
      riskLevel: pickRiskLevel(input.riskLevel),
      dietaryNotes: trimOrNull(input.dietaryNotes),
      medicalNotes: trimOrNull(input.medicalNotes),
      emergencyContactName: trimOrNull(input.emergencyContactName),
      emergencyContactPhone: trimOrNull(input.emergencyContactPhone),
      notes: trimOrNull(input.notes),
      createdById: input.createdById,
      ...photoData(input.photo),
    },
    select: SELECT,
  });
  return serialize(row);
}

export async function updateTraveler(
  id: number,
  patch: {
    name?: string;
    customerId?: number | null;
    email?: string | null;
    phone?: string | null;
    nationality?: string | null;
    dateOfBirth?: string | null;
    passportNumber?: string | null;
    passportExpiry?: string | null;
    status?: string;
    riskLevel?: string;
    dietaryNotes?: string | null;
    medicalNotes?: string | null;
    emergencyContactName?: string | null;
    emergencyContactPhone?: string | null;
    notes?: string | null;
  },
): Promise<TravelerSummary | null> {
  const existing = await prisma.traveler.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return null;

  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const v = patch.name.trim();
    if (v) data.name = v;
  }
  if (patch.customerId !== undefined) data.customerId = await resolveCustomerId(patch.customerId);
  if (patch.email !== undefined) data.email = trimOrNull(patch.email);
  if (patch.phone !== undefined) data.phone = trimOrNull(patch.phone);
  if (patch.nationality !== undefined) data.nationality = trimOrNull(patch.nationality);
  if (patch.dateOfBirth !== undefined) data.dateOfBirth = parseDate(patch.dateOfBirth);
  if (patch.passportNumber !== undefined) data.passportNumber = trimOrNull(patch.passportNumber);
  if (patch.passportExpiry !== undefined) data.passportExpiry = parseDate(patch.passportExpiry);
  if (patch.status !== undefined) data.status = pickStatus(patch.status);
  if (patch.riskLevel !== undefined) data.riskLevel = pickRiskLevel(patch.riskLevel);
  if (patch.dietaryNotes !== undefined) data.dietaryNotes = trimOrNull(patch.dietaryNotes);
  if (patch.medicalNotes !== undefined) data.medicalNotes = trimOrNull(patch.medicalNotes);
  if (patch.emergencyContactName !== undefined) data.emergencyContactName = trimOrNull(patch.emergencyContactName);
  if (patch.emergencyContactPhone !== undefined) data.emergencyContactPhone = trimOrNull(patch.emergencyContactPhone);
  if (patch.notes !== undefined) data.notes = trimOrNull(patch.notes);

  const row = await prisma.traveler.update({ where: { id }, data, select: SELECT });
  return serialize(row);
}

export async function deleteTraveler(id: number): Promise<boolean> {
  const existing = await prisma.traveler.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return false;
  await prisma.traveler.delete({ where: { id } });
  return true;
}

// --- Photo -----------------------------------------------------------------

export async function getTravelerPhoto(
  id: number,
): Promise<{ name: string; mime: string; content: Buffer } | null> {
  const row = await prisma.traveler.findUnique({
    where: { id },
    select: { photoName: true, photoMime: true, photoContent: true },
  });
  if (!row || !row.photoContent || !row.photoMime) return null;
  return { name: row.photoName ?? 'photo', mime: row.photoMime, content: Buffer.from(row.photoContent) };
}

export async function setTravelerPhoto(id: number, photo: PhotoInput): Promise<boolean> {
  const existing = await prisma.traveler.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return false;
  await prisma.traveler.update({ where: { id }, data: photoData(photo) });
  return true;
}
