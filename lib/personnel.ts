import 'server-only';

import { computeStatus, type LicenseStatus } from '@/lib/drivers';
import {
  ENGAGEMENT_TYPES,
  PERSONNEL_ROLES,
  type EngagementType,
  type PersonnelRole,
} from '@/lib/people-views';
import { syncPersonnelResources } from '@/lib/personnel-sync';
import { prisma } from '@/lib/prisma';

export const DEPARTMENTS = [
  'Operations',
  'Human Resources',
  'Finance',
  'Sales',
  'Administration',
  'Security',
  'IT',
] as const;
export const PERSONNEL_STATUSES = ['Active', 'On Leave', 'Remote', 'Terminated'] as const;

export type Department = (typeof DEPARTMENTS)[number];
export type PersonnelStatus = (typeof PERSONNEL_STATUSES)[number];

function pickDepartment(value: unknown): Department {
  return (DEPARTMENTS as readonly string[]).includes(value as string) ? (value as Department) : 'Operations';
}
function pickStatus(value: unknown): PersonnelStatus {
  return (PERSONNEL_STATUSES as readonly string[]).includes(value as string) ? (value as PersonnelStatus) : 'Active';
}
function pickEngagement(value: unknown): EngagementType {
  return (ENGAGEMENT_TYPES as readonly string[]).includes(value as string)
    ? (value as EngagementType)
    : 'Employee';
}
/** Keep only recognised roles, deduped and in canonical order. */
function normalizeRoles(value: unknown): PersonnelRole[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const match = PERSONNEL_ROLES.find((r) => r.toLowerCase() === raw.trim().toLowerCase());
    if (match) seen.add(match);
  }
  return PERSONNEL_ROLES.filter((r) => seen.has(r));
}
function trimOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return v.length > 0 ? v : null;
}
function normalizeSkills(value: unknown): string[] {
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
  return out.slice(0, 30);
}
function parseDate(value: unknown): Date | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' && !(value instanceof Date)) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// --- Serialized shape ------------------------------------------------------

export type PersonnelLicence = {
  id: number;
  licenseNumber: string;
  category: string;
  expiryDate: string;
  status: LicenseStatus;
  daysRemaining: number;
  hasDocument: boolean;
};

export type PersonnelSummary = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  department: string;
  status: string;
  location: string | null;
  manager: string | null;
  joinDate: string | null;
  skills: string[];
  roles: string[];
  engagement: string;
  supplierName: string | null;
  callSign: string | null;
  grade: string | null;
  /** Driving licences held by this person, soonest expiry first. */
  licenses: PersonnelLicence[];
  /** Which legacy assignable resources mirror this person. */
  resource: { driverId: number | null; officerId: number | null };
  notes: string | null;
  hasPhoto: boolean;
  user: { id: number; name: string; email: string } | null;
  createdAt: string;
};

const SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  department: true,
  status: true,
  location: true,
  manager: true,
  joinDate: true,
  skills: true,
  roles: true,
  engagement: true,
  supplierName: true,
  callSign: true,
  grade: true,
  licenses: {
    orderBy: { expiryDate: 'asc' },
    select: {
      id: true,
      licenseNumber: true,
      category: true,
      expiryDate: true,
      documentName: true,
    },
  },
  driverProfile: { select: { id: true } },
  officerProfile: { select: { id: true } },
  notes: true,
  photoName: true,
  createdAt: true,
  user: { select: { id: true, name: true, email: true } },
} as const;

type PersonnelRow = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  department: string;
  status: string;
  location: string | null;
  manager: string | null;
  joinDate: Date | null;
  skills: string[];
  roles: string[];
  engagement: string;
  supplierName: string | null;
  callSign: string | null;
  grade: string | null;
  licenses: {
    id: number;
    licenseNumber: string;
    category: string;
    expiryDate: Date;
    documentName: string | null;
  }[];
  driverProfile: { id: number } | null;
  officerProfile: { id: number } | null;
  notes: string | null;
  photoName: string | null;
  createdAt: Date;
  user: { id: number; name: string; email: string } | null;
};

function serialize(row: PersonnelRow): PersonnelSummary {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    department: row.department,
    status: row.status,
    location: row.location,
    manager: row.manager,
    joinDate: row.joinDate?.toISOString() ?? null,
    skills: row.skills ?? [],
    roles: row.roles ?? [],
    engagement: row.engagement,
    supplierName: row.supplierName,
    callSign: row.callSign,
    grade: row.grade,
    licenses: (row.licenses ?? []).map((l) => {
      // Reuse the single source of truth for licence expiry state.
      const { status, daysRemaining } = computeStatus(l.expiryDate);
      return {
        id: l.id,
        licenseNumber: l.licenseNumber,
        category: l.category,
        expiryDate: l.expiryDate.toISOString(),
        status,
        daysRemaining,
        hasDocument: Boolean(l.documentName),
      };
    }),
    resource: {
      driverId: row.driverProfile?.id ?? null,
      officerId: row.officerProfile?.id ?? null,
    },
    notes: row.notes,
    hasPhoto: Boolean(row.photoName),
    user: row.user,
    createdAt: row.createdAt.toISOString(),
  };
}

// --- Reads -----------------------------------------------------------------

/**
 * All personnel, or only those holding `role`. The role pages
 * (drivers, cpos, airport-greeters, security-advisors) all come through here.
 */
export async function listPersonnel(options?: { role?: PersonnelRole | null }): Promise<PersonnelSummary[]> {
  const role = options?.role ?? null;
  const rows = await prisma.personnel.findMany({
    where: role ? { roles: { has: role } } : undefined,
    orderBy: [{ name: 'asc' }],
    select: SELECT,
  });
  return rows.map(serialize);
}

/** A single person, for the detail drawer and licence editing. */
export async function getPersonnelById(id: number): Promise<PersonnelSummary | null> {
  const row = await prisma.personnel.findUnique({ where: { id }, select: SELECT });
  return row ? serialize(row) : null;
}

export type UserOption = { id: number; name: string; email: string; linkedToId: number | null };

/** Active login accounts available to link, flagged with any existing personnel link. */
export async function listUserOptions(): Promise<UserOption[]> {
  const [users, linked] = await Promise.all([
    prisma.user.findMany({ where: { status: 'active' }, orderBy: { name: 'asc' }, select: { id: true, name: true, email: true } }),
    prisma.personnel.findMany({ where: { userId: { not: null } }, select: { id: true, userId: true } }),
  ]);
  const linkMap = new Map<number, number>();
  for (const p of linked) if (p.userId != null) linkMap.set(p.userId, p.id);
  return users.map((u) => ({ id: u.id, name: u.name, email: u.email, linkedToId: linkMap.get(u.id) ?? null }));
}

// --- Writes ----------------------------------------------------------------

export type PhotoInput = { name: string; mime: string; size: number; content: Buffer };

function photoData(photo: PhotoInput | null | undefined) {
  return photo ? { photoName: photo.name, photoMime: photo.mime, photoSize: photo.size, photoContent: photo.content } : {};
}

/** Resolve an optional user link, ensuring the user exists and isn't linked elsewhere. */
async function resolveUserId(userId: unknown, selfId: number | null): Promise<number | null> {
  if (userId == null) return null;
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const exists = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return null;
  const taken = await prisma.personnel.findUnique({ where: { userId: id }, select: { id: true } });
  if (taken && taken.id !== selfId) throw new Error('That login account is already linked to another personnel record');
  return id;
}

export async function createPersonnel(input: {
  userId?: number | null;
  createdById: number;
  name: string;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
  department?: string;
  status?: string;
  location?: string | null;
  manager?: string | null;
  joinDate?: string | null;
  skills?: unknown;
  roles?: unknown;
  engagement?: string;
  supplierName?: string | null;
  callSign?: string | null;
  grade?: string | null;
  notes?: string | null;
  photo?: PhotoInput | null;
}): Promise<PersonnelSummary> {
  const name = input.name.trim();
  if (!name) throw new Error('Name is required');
  const linkedUserId = await resolveUserId(input.userId, null);

  const row = await prisma.personnel.create({
    data: {
      name,
      email: trimOrNull(input.email),
      phone: trimOrNull(input.phone),
      role: trimOrNull(input.role),
      department: pickDepartment(input.department),
      status: pickStatus(input.status),
      location: trimOrNull(input.location),
      manager: trimOrNull(input.manager),
      joinDate: parseDate(input.joinDate),
      skills: normalizeSkills(input.skills),
      roles: normalizeRoles(input.roles),
      engagement: pickEngagement(input.engagement),
      supplierName: trimOrNull(input.supplierName),
      callSign: trimOrNull(input.callSign),
      grade: trimOrNull(input.grade),
      notes: trimOrNull(input.notes),
      userId: linkedUserId,
      createdById: input.createdById,
      ...photoData(input.photo),
    },
    select: SELECT,
  });
  await syncPersonnelResources(row.id);
  return (await getPersonnelById(row.id)) ?? serialize(row);
}

export async function updatePersonnel(
  id: number,
  patch: {
    userId?: number | null;
    name?: string;
    email?: string | null;
    phone?: string | null;
    role?: string | null;
    department?: string;
    status?: string;
    location?: string | null;
    manager?: string | null;
    joinDate?: string | null;
    skills?: unknown;
    roles?: unknown;
    engagement?: string;
    supplierName?: string | null;
    callSign?: string | null;
    grade?: string | null;
    notes?: string | null;
  },
): Promise<PersonnelSummary | null> {
  const existing = await prisma.personnel.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return null;

  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const v = patch.name.trim();
    if (v) data.name = v;
  }
  if (patch.email !== undefined) data.email = trimOrNull(patch.email);
  if (patch.phone !== undefined) data.phone = trimOrNull(patch.phone);
  if (patch.role !== undefined) data.role = trimOrNull(patch.role);
  if (patch.department !== undefined) data.department = pickDepartment(patch.department);
  if (patch.status !== undefined) data.status = pickStatus(patch.status);
  if (patch.location !== undefined) data.location = trimOrNull(patch.location);
  if (patch.manager !== undefined) data.manager = trimOrNull(patch.manager);
  if (patch.joinDate !== undefined) data.joinDate = parseDate(patch.joinDate);
  if (patch.skills !== undefined) data.skills = normalizeSkills(patch.skills);
  if (patch.roles !== undefined) data.roles = normalizeRoles(patch.roles);
  if (patch.engagement !== undefined) data.engagement = pickEngagement(patch.engagement);
  if (patch.supplierName !== undefined) data.supplierName = trimOrNull(patch.supplierName);
  if (patch.callSign !== undefined) data.callSign = trimOrNull(patch.callSign);
  if (patch.grade !== undefined) data.grade = trimOrNull(patch.grade);
  if (patch.notes !== undefined) data.notes = trimOrNull(patch.notes);
  if (patch.userId !== undefined) data.userId = await resolveUserId(patch.userId, id);

  const row = await prisma.personnel.update({ where: { id }, data, select: SELECT });
  await syncPersonnelResources(row.id);
  return (await getPersonnelById(row.id)) ?? serialize(row);
}

export async function deletePersonnel(id: number): Promise<boolean> {
  const existing = await prisma.personnel.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return false;
  await prisma.personnel.delete({ where: { id } });
  return true;
}

// --- Photo -----------------------------------------------------------------

export async function getPersonnelPhoto(id: number): Promise<{ name: string; mime: string; content: Buffer } | null> {
  const row = await prisma.personnel.findUnique({
    where: { id },
    select: { photoName: true, photoMime: true, photoContent: true },
  });
  if (!row || !row.photoContent || !row.photoMime) return null;
  return { name: row.photoName ?? 'photo', mime: row.photoMime, content: Buffer.from(row.photoContent) };
}

export async function setPersonnelPhoto(id: number, photo: PhotoInput): Promise<boolean> {
  const existing = await prisma.personnel.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return false;
  await prisma.personnel.update({
    where: { id },
    data: { photoName: photo.name, photoMime: photo.mime, photoSize: photo.size, photoContent: photo.content },
  });
  return true;
}
