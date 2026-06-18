import 'server-only';

import { prisma } from '@/lib/prisma';

export const CONTRACT_TYPES = ['Fixed Term', 'Retainer', 'Project Based'] as const;
// Stored lifecycle states an admin can set explicitly.
export const CONTRACT_LIFECYCLE = ['Active', 'In Renewal', 'Renewed', 'Cancelled'] as const;
// Derived statuses shown in the UI (lifecycle + date-driven Active/Expiring/Expired).
export const CONTRACT_DISPLAY_STATUSES = [
  'Active',
  'Expiring Soon',
  'In Renewal',
  'Renewed',
  'Expired',
  'Cancelled',
] as const;

export type ContractType = (typeof CONTRACT_TYPES)[number];
export type ContractLifecycle = (typeof CONTRACT_LIFECYCLE)[number];
export type ContractDisplayStatus = (typeof CONTRACT_DISPLAY_STATUSES)[number];

export const EXPIRING_SOON_DAYS = 30;

export function isValidType(value: unknown): value is ContractType {
  return typeof value === 'string' && (CONTRACT_TYPES as readonly string[]).includes(value);
}
export function isValidLifecycle(value: unknown): value is ContractLifecycle {
  return typeof value === 'string' && (CONTRACT_LIFECYCLE as readonly string[]).includes(value);
}

export type ContractSummary = {
  id: number;
  reference: string;
  counterpartyName: string;
  email: string | null;
  department: string | null;
  type: string;
  lifecycle: string; // stored status
  status: ContractDisplayStatus; // derived display status
  startDate: string;
  endDate: string;
  daysRemaining: number;
  value: number | null;
  currency: string;
  lastRenewalDate: string | null;
  notes: string | null;
  hasDocument: boolean;
  document: { name: string; mime: string; size: number } | null;
  createdAt: string;
};

export type ContractStats = {
  total: number;
  expiringSoon: number;
  inRenewal: number;
  expired: number;
};

/** Days remaining until the contract end date, relative to the start of today. */
function daysUntil(end: Date): number {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endDay = new Date(end);
  endDay.setHours(0, 0, 0, 0);
  return Math.round((endDay.getTime() - startOfToday.getTime()) / 86400000);
}

/** Combine the stored lifecycle with the date window into a single display status. */
export function computeDisplayStatus(lifecycle: string, end: Date): ContractDisplayStatus {
  if (lifecycle === 'Cancelled') return 'Cancelled';
  if (lifecycle === 'Renewed') return 'Renewed';
  if (lifecycle === 'In Renewal') return 'In Renewal';
  const days = daysUntil(end);
  if (days < 0) return 'Expired';
  if (days <= EXPIRING_SOON_DAYS) return 'Expiring Soon';
  return 'Active';
}

type ContractRow = {
  id: number;
  reference: string;
  counterpartyName: string;
  email: string | null;
  department: string | null;
  type: string;
  status: string;
  startDate: Date;
  endDate: Date;
  value: number | null;
  currency: string;
  lastRenewalDate: Date | null;
  notes: string | null;
  documentName: string | null;
  documentMime: string | null;
  documentSize: number | null;
  createdAt: Date;
};

function serialize(row: ContractRow): ContractSummary {
  const hasDocument = Boolean(row.documentName);
  return {
    id: row.id,
    reference: row.reference,
    counterpartyName: row.counterpartyName,
    email: row.email,
    department: row.department,
    type: row.type,
    lifecycle: row.status,
    status: computeDisplayStatus(row.status, row.endDate),
    startDate: row.startDate.toISOString(),
    endDate: row.endDate.toISOString(),
    daysRemaining: daysUntil(row.endDate),
    value: row.value,
    currency: row.currency,
    lastRenewalDate: row.lastRenewalDate?.toISOString() ?? null,
    notes: row.notes,
    hasDocument,
    document: hasDocument
      ? { name: row.documentName!, mime: row.documentMime ?? 'application/octet-stream', size: row.documentSize ?? 0 }
      : null,
    createdAt: row.createdAt.toISOString(),
  };
}

const CONTRACT_SELECT = {
  id: true,
  reference: true,
  counterpartyName: true,
  email: true,
  department: true,
  type: true,
  status: true,
  startDate: true,
  endDate: true,
  value: true,
  currency: true,
  lastRenewalDate: true,
  notes: true,
  documentName: true,
  documentMime: true,
  documentSize: true,
  createdAt: true,
} as const;

export async function listContracts(): Promise<ContractSummary[]> {
  const rows = await prisma.contract.findMany({ orderBy: [{ endDate: 'asc' }], select: CONTRACT_SELECT });
  return rows.map(serialize);
}

export function computeStats(items: ContractSummary[]): ContractStats {
  return {
    total: items.length,
    expiringSoon: items.filter((i) => i.status === 'Expiring Soon').length,
    inRenewal: items.filter((i) => i.status === 'In Renewal').length,
    expired: items.filter((i) => i.status === 'Expired').length,
  };
}

export async function createContract(input: {
  userId: number;
  reference: string;
  counterpartyName: string;
  email?: string | null;
  department?: string | null;
  type?: string;
  status?: string;
  startDate: Date;
  endDate: Date;
  value?: number | null;
  currency?: string;
  lastRenewalDate?: Date | null;
  notes?: string | null;
  document?: { name: string; mime: string; size: number; content: Buffer } | null;
}): Promise<ContractSummary> {
  const reference = input.reference.trim();
  const counterpartyName = input.counterpartyName.trim();
  if (!reference) throw new Error('Contract reference is required');
  if (!counterpartyName) throw new Error('Counterparty name is required');
  if (Number.isNaN(input.startDate.getTime())) throw new Error('A valid start date is required');
  if (Number.isNaN(input.endDate.getTime())) throw new Error('A valid end date is required');
  if (input.endDate.getTime() < input.startDate.getTime()) throw new Error('End date must be after the start date');

  const existing = await prisma.contract.findUnique({ where: { reference }, select: { id: true } });
  if (existing) throw new Error(`A contract with reference "${reference}" already exists`);

  const row = await prisma.contract.create({
    data: {
      reference,
      counterpartyName,
      email: input.email?.trim() || null,
      department: input.department?.trim() || null,
      type: isValidType(input.type) ? input.type : 'Fixed Term',
      status: isValidLifecycle(input.status) ? input.status : 'Active',
      startDate: input.startDate,
      endDate: input.endDate,
      value: input.value != null && Number.isFinite(input.value) ? Math.trunc(input.value) : null,
      currency: input.currency?.trim() || 'USD',
      lastRenewalDate: input.lastRenewalDate ?? null,
      notes: input.notes?.trim() || null,
      createdById: input.userId,
      ...(input.document
        ? {
            documentName: input.document.name,
            documentMime: input.document.mime,
            documentSize: input.document.size,
            documentContent: input.document.content,
          }
        : {}),
    },
    select: CONTRACT_SELECT,
  });
  return serialize(row);
}

export async function updateContract(
  id: number,
  patch: {
    reference?: string;
    counterpartyName?: string;
    email?: string | null;
    department?: string | null;
    type?: string;
    status?: string;
    startDate?: Date;
    endDate?: Date;
    value?: number | null;
    currency?: string;
    lastRenewalDate?: Date | null;
    notes?: string | null;
  },
): Promise<ContractSummary | null> {
  const existing = await prisma.contract.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return null;

  const data: Record<string, unknown> = {};
  if (patch.reference !== undefined) {
    const v = patch.reference.trim();
    if (v) data.reference = v;
  }
  if (patch.counterpartyName !== undefined) {
    const v = patch.counterpartyName.trim();
    if (v) data.counterpartyName = v;
  }
  if (patch.email !== undefined) data.email = patch.email?.trim() || null;
  if (patch.department !== undefined) data.department = patch.department?.trim() || null;
  if (patch.type !== undefined && isValidType(patch.type)) data.type = patch.type;
  if (patch.status !== undefined && isValidLifecycle(patch.status)) data.status = patch.status;
  if (patch.startDate !== undefined && !Number.isNaN(patch.startDate.getTime())) data.startDate = patch.startDate;
  if (patch.endDate !== undefined && !Number.isNaN(patch.endDate.getTime())) data.endDate = patch.endDate;
  if (patch.value !== undefined) data.value = patch.value != null && Number.isFinite(patch.value) ? Math.trunc(patch.value) : null;
  if (patch.currency !== undefined && patch.currency.trim()) data.currency = patch.currency.trim();
  if (patch.lastRenewalDate !== undefined) data.lastRenewalDate = patch.lastRenewalDate;
  if (patch.notes !== undefined) data.notes = patch.notes?.trim() || null;

  const row = await prisma.contract.update({ where: { id }, data, select: CONTRACT_SELECT });
  return serialize(row);
}

export async function deleteContract(id: number): Promise<boolean> {
  const existing = await prisma.contract.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return false;
  await prisma.contract.delete({ where: { id } });
  return true;
}

export async function setContractDocument(
  id: number,
  document: { name: string; mime: string; size: number; content: Buffer },
): Promise<ContractSummary | null> {
  const existing = await prisma.contract.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return null;
  const row = await prisma.contract.update({
    where: { id },
    data: {
      documentName: document.name,
      documentMime: document.mime,
      documentSize: document.size,
      documentContent: document.content,
    },
    select: CONTRACT_SELECT,
  });
  return serialize(row);
}

export async function getContractDocument(
  id: number,
): Promise<{ name: string; mime: string; content: Buffer } | null> {
  const row = await prisma.contract.findUnique({
    where: { id },
    select: { documentName: true, documentMime: true, documentContent: true },
  });
  if (!row || !row.documentContent) return null;
  return {
    name: row.documentName ?? 'contract-document',
    mime: row.documentMime ?? 'application/octet-stream',
    content: Buffer.from(row.documentContent),
  };
}
