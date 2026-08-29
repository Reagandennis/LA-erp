import 'server-only';

import { prisma } from '@/lib/prisma';

export const LICENSE_CATEGORIES = [
  'Class A',
  'Class B',
  'Class C',
  'Commercial',
  'Special',
] as const;

export type LicenseCategory = (typeof LICENSE_CATEGORIES)[number];
export type LicenseStatus = 'Valid' | 'Expiring Soon' | 'Expired';

export const EXPIRING_SOON_DAYS = 30;

export type DriverLicenseSummary = {
  id: number;
  driverName: string;
  /** Owning personnel record; null for legacy rows that never matched a person. */
  personnelId: number | null;
  licenseNumber: string;
  category: string;
  expiryDate: string;
  lastVerified: string | null;
  notes: string | null;
  status: LicenseStatus;
  daysRemaining: number;
  hasDocument: boolean;
  document: { name: string; mime: string; size: number } | null;
  createdAt: string;
};

export type DriverLicenseStats = {
  total: number;
  expired: number;
  expiringSoon: number;
  valid: number;
};

export function isValidCategory(value: unknown): value is LicenseCategory {
  return typeof value === 'string' && (LICENSE_CATEGORIES as readonly string[]).includes(value);
}

/** Compute days remaining and status from an expiry date, relative to now. */
export function computeStatus(expiry: Date): { status: LicenseStatus; daysRemaining: number } {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const expiryDay = new Date(expiry);
  expiryDay.setHours(0, 0, 0, 0);
  const daysRemaining = Math.round((expiryDay.getTime() - startOfToday.getTime()) / 86400000);

  let status: LicenseStatus;
  if (daysRemaining < 0) status = 'Expired';
  else if (daysRemaining <= EXPIRING_SOON_DAYS) status = 'Expiring Soon';
  else status = 'Valid';

  return { status, daysRemaining };
}

type LicenseRow = {
  id: number;
  driverName: string;
  personnelId: number | null;
  licenseNumber: string;
  category: string;
  expiryDate: Date;
  lastVerified: Date | null;
  notes: string | null;
  documentName: string | null;
  documentMime: string | null;
  documentSize: number | null;
  createdAt: Date;
};

function serialize(row: LicenseRow): DriverLicenseSummary {
  const { status, daysRemaining } = computeStatus(row.expiryDate);
  const hasDocument = Boolean(row.documentName);
  return {
    id: row.id,
    driverName: row.driverName,
    personnelId: row.personnelId,
    licenseNumber: row.licenseNumber,
    category: row.category,
    expiryDate: row.expiryDate.toISOString(),
    lastVerified: row.lastVerified?.toISOString() ?? null,
    notes: row.notes,
    status,
    daysRemaining,
    hasDocument,
    document: hasDocument
      ? { name: row.documentName!, mime: row.documentMime ?? 'application/octet-stream', size: row.documentSize ?? 0 }
      : null,
    createdAt: row.createdAt.toISOString(),
  };
}

const LICENSE_SELECT = {
  id: true,
  driverName: true,
  personnelId: true,
  licenseNumber: true,
  category: true,
  expiryDate: true,
  lastVerified: true,
  notes: true,
  documentName: true,
  documentMime: true,
  documentSize: true,
  createdAt: true,
} as const;

/** All driver licenses (shared org-wide registry), soonest expiry first. */
export async function listDriverLicenses(): Promise<DriverLicenseSummary[]> {
  const rows = await prisma.driverLicense.findMany({
    orderBy: [{ expiryDate: 'asc' }],
    select: LICENSE_SELECT,
  });
  return rows.map(serialize);
}

export function computeStats(items: DriverLicenseSummary[]): DriverLicenseStats {
  return {
    total: items.length,
    expired: items.filter((i) => i.status === 'Expired').length,
    expiringSoon: items.filter((i) => i.status === 'Expiring Soon').length,
    valid: items.filter((i) => i.status === 'Valid').length,
  };
}

export async function createDriverLicense(input: {
  userId: number;
  driverName: string;
  personnelId?: number | null;
  licenseNumber: string;
  category: string;
  expiryDate: Date;
  lastVerified?: Date | null;
  notes?: string | null;
  document?: { name: string; mime: string; size: number; content: Buffer } | null;
}): Promise<DriverLicenseSummary> {
  const driverName = input.driverName.trim();
  const licenseNumber = input.licenseNumber.trim();
  if (!driverName) throw new Error('Driver name is required');
  if (!licenseNumber) throw new Error('License number is required');
  if (Number.isNaN(input.expiryDate.getTime())) throw new Error('A valid expiry date is required');
  const category = isValidCategory(input.category) ? input.category : 'Class A';

  const row = await prisma.driverLicense.create({
    data: {
      driverName,
      licenseNumber,
      category,
      expiryDate: input.expiryDate,
      lastVerified: input.lastVerified ?? null,
      notes: input.notes?.trim() || null,
      createdById: input.userId,
      personnelId: input.personnelId ?? null,
      ...(input.document
        ? {
            documentName: input.document.name,
            documentMime: input.document.mime,
            documentSize: input.document.size,
            documentContent: input.document.content,
          }
        : {}),
    },
    select: LICENSE_SELECT,
  });
  return serialize(row);
}

export async function updateDriverLicense(
  id: number,
  patch: {
    driverName?: string;
    personnelId?: number | null;
    licenseNumber?: string;
    category?: string;
    expiryDate?: Date;
    lastVerified?: Date | null;
    notes?: string | null;
  },
): Promise<DriverLicenseSummary | null> {
  const existing = await prisma.driverLicense.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return null;

  const data: Record<string, unknown> = {};
  if (patch.driverName !== undefined) {
    const v = patch.driverName.trim();
    if (v) data.driverName = v;
  }
  if (patch.personnelId !== undefined) data.personnelId = patch.personnelId;
  if (patch.licenseNumber !== undefined) {
    const v = patch.licenseNumber.trim();
    if (v) data.licenseNumber = v;
  }
  if (patch.category !== undefined && isValidCategory(patch.category)) data.category = patch.category;
  if (patch.expiryDate !== undefined && !Number.isNaN(patch.expiryDate.getTime())) data.expiryDate = patch.expiryDate;
  if (patch.lastVerified !== undefined) data.lastVerified = patch.lastVerified;
  if (patch.notes !== undefined) data.notes = patch.notes?.trim() || null;

  const row = await prisma.driverLicense.update({
    where: { id },
    data,
    select: LICENSE_SELECT,
  });
  return serialize(row);
}

export async function deleteDriverLicense(id: number): Promise<boolean> {
  const existing = await prisma.driverLicense.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return false;
  await prisma.driverLicense.delete({ where: { id } });
  return true;
}

export async function setDriverLicenseDocument(
  id: number,
  document: { name: string; mime: string; size: number; content: Buffer },
): Promise<DriverLicenseSummary | null> {
  const existing = await prisma.driverLicense.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return null;
  const row = await prisma.driverLicense.update({
    where: { id },
    data: {
      documentName: document.name,
      documentMime: document.mime,
      documentSize: document.size,
      documentContent: document.content,
    },
    select: LICENSE_SELECT,
  });
  return serialize(row);
}

export async function getDriverLicenseDocument(
  id: number,
): Promise<{ name: string; mime: string; content: Buffer } | null> {
  const row = await prisma.driverLicense.findUnique({
    where: { id },
    select: { documentName: true, documentMime: true, documentContent: true },
  });
  if (!row || !row.documentContent) return null;
  return {
    name: row.documentName ?? 'license-document',
    mime: row.documentMime ?? 'application/octet-stream',
    content: Buffer.from(row.documentContent),
  };
}

// --- Person-scoped licences ------------------------------------------------

/**
 * Licences held by one person, soonest expiry first. Editing a licence now
 * happens on the person; the standalone compliance module is a read-only
 * watchlist over the same rows.
 */
export async function listLicensesForPersonnel(personnelId: number): Promise<DriverLicenseSummary[]> {
  const rows = await prisma.driverLicense.findMany({
    where: { personnelId },
    orderBy: [{ expiryDate: 'asc' }],
    select: LICENSE_SELECT,
  });
  return rows.map(serialize);
}

/** Attach an orphaned licence to a person (or detach it with null). */
export async function linkLicenseToPersonnel(
  licenseId: number,
  personnelId: number | null,
): Promise<DriverLicenseSummary | null> {
  const existing = await prisma.driverLicense.findUnique({ where: { id: licenseId }, select: { id: true } });
  if (!existing) return null;

  // Keep the denormalised display name true to the person we just linked.
  const person = personnelId
    ? await prisma.personnel.findUnique({ where: { id: personnelId }, select: { name: true } })
    : null;
  if (personnelId && !person) return null;

  const row = await prisma.driverLicense.update({
    where: { id: licenseId },
    data: { personnelId, ...(person ? { driverName: person.name } : {}) },
    select: LICENSE_SELECT,
  });
  return serialize(row);
}
