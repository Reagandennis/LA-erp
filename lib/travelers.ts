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

export type TravelerSummary = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  nationality: string | null;
  dateOfBirth: string | null;
  passportNumber: string | null;
  passportExpiry: string | null;
  status: string;
  riskLevel: string;
  dietaryNotes: string | null;
  medicalNotes: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  notes: string | null;
  hasPhoto: boolean;
  customer: { id: number; name: string; company: string | null } | null;
  tripCount: number;
  createdAt: string;
};

const SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  nationality: true,
  dateOfBirth: true,
  passportNumber: true,
  passportExpiry: true,
  status: true,
  riskLevel: true,
  dietaryNotes: true,
  medicalNotes: true,
  emergencyContactName: true,
  emergencyContactPhone: true,
  notes: true,
  photoName: true,
  createdAt: true,
  customer: { select: { id: true, name: true, company: true } },
  _count: { select: { trips: true } },
} as const;

type TravelerRow = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  nationality: string | null;
  dateOfBirth: Date | null;
  passportNumber: string | null;
  passportExpiry: Date | null;
  status: string;
  riskLevel: string;
  dietaryNotes: string | null;
  medicalNotes: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  notes: string | null;
  photoName: string | null;
  createdAt: Date;
  customer: { id: number; name: string; company: string | null } | null;
  _count: { trips: number };
};

function serialize(row: TravelerRow): TravelerSummary {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    nationality: row.nationality,
    dateOfBirth: row.dateOfBirth?.toISOString() ?? null,
    passportNumber: row.passportNumber,
    passportExpiry: row.passportExpiry?.toISOString() ?? null,
    status: row.status,
    riskLevel: row.riskLevel,
    dietaryNotes: row.dietaryNotes,
    medicalNotes: row.medicalNotes,
    emergencyContactName: row.emergencyContactName,
    emergencyContactPhone: row.emergencyContactPhone,
    notes: row.notes,
    hasPhoto: Boolean(row.photoName),
    customer: row.customer,
    tripCount: row._count.trips,
    createdAt: row.createdAt.toISOString(),
  };
}

// --- Reads -----------------------------------------------------------------

export async function listTravelers(): Promise<TravelerSummary[]> {
  const rows = await prisma.traveler.findMany({ orderBy: [{ name: 'asc' }], select: SELECT });
  return rows.map(serialize);
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
