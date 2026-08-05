import 'server-only';

import { prisma } from './prisma';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Business entities customers are segmented into. */
export const CUSTOMER_ENTITIES = ['LADYASKARI', 'LIONESS', 'STARLLWART'] as const;
export type CustomerEntity = (typeof CUSTOMER_ENTITIES)[number];

export const DEFAULT_ENTITY: CustomerEntity = 'LADYASKARI';

/**
 * Pipeline stages in flow order. "Outstanding 30+ days" is not a stored stage —
 * a deal in `invoiced` whose stage is older than OUTSTANDING_AFTER_DAYS is
 * surfaced in that board column automatically.
 */
export const DEAL_STAGES = [
  { key: 'lead', label: 'Lead' },
  { key: 'onboarding', label: 'Contract / NDA' },
  { key: 'proposal', label: 'Quote / Proposal' },
  { key: 'won', label: 'Won' },
  { key: 'execution', label: 'Execution' },
  { key: 'invoiced', label: 'Invoice Submitted' },
  { key: 'closed', label: 'Received / Closed' },
  { key: 'lost', label: 'Lost' },
] as const;

export type DealStage = (typeof DEAL_STAGES)[number]['key'];
export const DEAL_STAGE_KEYS = DEAL_STAGES.map((s) => s.key) as DealStage[];

export const OUTSTANDING_AFTER_DAYS = 30;

export const SIGNATURE_STATUSES = ['none', 'sent', 'signed', 'declined'] as const;
export type SignatureStatus = (typeof SIGNATURE_STATUSES)[number];

export const ACTIVITY_TYPES = ['call', 'email', 'meeting', 'note'] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DealSummary {
  id: number;
  title: string;
  stage: DealStage;
  value: number;
  currency: string;
  customer: { id: number; name: string; entity: string };
  quote: { id: number; reference: string; status: string; total: number } | null;
  contract: { id: number; reference: string; status: string } | null;
  signatureStatus: SignatureStatus;
  expectedCloseDate: string | null;
  lostReason: string | null;
  notes: string | null;
  stageChangedAt: string;
  daysInStage: number;
  /** True when invoiced and unpaid for more than OUTSTANDING_AFTER_DAYS. */
  isOutstanding: boolean;
  createdAt: string;
}

export interface CrmContact {
  id: number;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
}

export interface CrmCustomer {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  address: string | null;
  billingAddress: string | null;
  entity: string;
  contacts: CrmContact[];
  dealCount: number;
  createdAt: string;
}

export interface CrmActivitySummary {
  id: number;
  customerId: number;
  dealId: number | null;
  contactId: number | null;
  contactName: string | null;
  type: ActivityType;
  summary: string;
  occurredAt: string;
  createdBy: string;
}

export interface QuoteOption {
  id: number;
  reference: string;
  subject: string;
  status: string;
  total: number;
  customerId: number;
}

export interface ContractOption {
  id: number;
  reference: string;
  counterpartyName: string;
  status: string;
}

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------

const DEAL_INCLUDE = {
  customer: { select: { id: true, name: true, entity: true } },
  quote: { select: { id: true, reference: true, status: true, total: true } },
  contract: { select: { id: true, reference: true, status: true } },
} as const;

type DealRow = {
  id: number;
  title: string;
  stage: string;
  value: unknown;
  currency: string;
  signatureStatus: string;
  expectedCloseDate: Date | null;
  lostReason: string | null;
  notes: string | null;
  stageChangedAt: Date;
  createdAt: Date;
  customer: { id: number; name: string; entity: string };
  quote: { id: number; reference: string; status: string; total: unknown } | null;
  contract: { id: number; reference: string; status: string } | null;
};

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86400000);
}

function serializeDeal(row: DealRow): DealSummary {
  const now = new Date();
  const daysInStage = daysBetween(row.stageChangedAt, now);
  return {
    id: row.id,
    title: row.title,
    stage: row.stage as DealStage,
    value: Number(row.value),
    currency: row.currency,
    customer: row.customer,
    quote: row.quote
      ? { id: row.quote.id, reference: row.quote.reference, status: row.quote.status, total: Number(row.quote.total) }
      : null,
    contract: row.contract,
    signatureStatus: row.signatureStatus as SignatureStatus,
    expectedCloseDate: row.expectedCloseDate?.toISOString() ?? null,
    lostReason: row.lostReason,
    notes: row.notes,
    stageChangedAt: row.stageChangedAt.toISOString(),
    daysInStage,
    isOutstanding: row.stage === 'invoiced' && daysInStage > OUTSTANDING_AFTER_DAYS,
    createdAt: row.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listDeals(): Promise<DealSummary[]> {
  const rows = await prisma.deal.findMany({
    orderBy: [{ stageChangedAt: 'desc' }],
    include: DEAL_INCLUDE,
  });
  return rows.map(serializeDeal);
}

export async function listCrmCustomers(): Promise<CrmCustomer[]> {
  const rows = await prisma.customer.findMany({
    orderBy: [{ name: 'asc' }],
    include: {
      contacts: {
        orderBy: { name: 'asc' },
        select: { id: true, name: true, role: true, email: true, phone: true },
      },
      _count: { select: { deals: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    company: row.company,
    address: row.address,
    billingAddress: row.billingAddress,
    entity: row.entity,
    contacts: row.contacts,
    dealCount: row._count.deals,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function listCrmActivities(limit = 500): Promise<CrmActivitySummary[]> {
  const rows = await prisma.crmActivity.findMany({
    orderBy: { occurredAt: 'desc' },
    take: limit,
    include: {
      contact: { select: { name: true } },
      createdBy: { select: { name: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    customerId: row.customerId,
    dealId: row.dealId,
    contactId: row.contactId,
    contactName: row.contact?.name ?? null,
    type: row.type as ActivityType,
    summary: row.summary,
    occurredAt: row.occurredAt.toISOString(),
    createdBy: row.createdBy.name,
  }));
}

/** Quotes available for linking to deals (all non-void quotes, newest first). */
export async function listQuoteOptions(): Promise<QuoteOption[]> {
  const rows = await prisma.quote.findMany({
    orderBy: { createdAt: 'desc' },
    take: 300,
    select: { id: true, reference: true, subject: true, status: true, total: true, customerId: true },
  });
  return rows.map((row) => ({
    id: row.id,
    reference: row.reference,
    subject: row.subject,
    status: row.status,
    total: Number(row.total),
    customerId: row.customerId,
  }));
}

export async function listContractOptions(): Promise<ContractOption[]> {
  const rows = await prisma.contract.findMany({
    orderBy: { createdAt: 'desc' },
    take: 300,
    select: { id: true, reference: true, counterpartyName: true, status: true },
  });
  return rows;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

function isEntity(value: unknown): value is CustomerEntity {
  return typeof value === 'string' && (CUSTOMER_ENTITIES as readonly string[]).includes(value);
}

function isStage(value: unknown): value is DealStage {
  return typeof value === 'string' && (DEAL_STAGE_KEYS as readonly string[]).includes(value);
}

export interface CreateDealInput {
  title: string;
  customerId: number;
  stage?: string;
  value?: number;
  currency?: string;
  quoteId?: number | null;
  contractId?: number | null;
  expectedCloseDate?: string | null;
  notes?: string | null;
}

export async function createDeal(
  userId: number,
  input: CreateDealInput,
): Promise<DealSummary | { error: string }> {
  const title = input.title?.trim();
  if (!title) return { error: 'Deal title is required' };

  const customer = await prisma.customer.findUnique({ where: { id: input.customerId }, select: { id: true } });
  if (!customer) return { error: 'Customer not found' };

  const stage = input.stage === undefined ? 'lead' : input.stage;
  if (!isStage(stage)) return { error: 'Invalid stage' };

  const value = input.value ?? 0;
  if (!Number.isFinite(value) || value < 0) return { error: 'Invalid deal value' };

  const row = await prisma.deal.create({
    data: {
      title,
      customerId: input.customerId,
      stage,
      value,
      currency: input.currency?.trim() || 'USD',
      quoteId: input.quoteId ?? null,
      contractId: input.contractId ?? null,
      expectedCloseDate: input.expectedCloseDate ? new Date(input.expectedCloseDate) : null,
      notes: input.notes?.trim() || null,
      createdById: userId,
    },
    include: DEAL_INCLUDE,
  });
  return serializeDeal(row);
}

export interface UpdateDealInput {
  title?: string;
  stage?: string;
  value?: number;
  currency?: string;
  quoteId?: number | null;
  contractId?: number | null;
  signatureStatus?: string;
  expectedCloseDate?: string | null;
  lostReason?: string | null;
  notes?: string | null;
}

export async function updateDeal(
  id: number,
  patch: UpdateDealInput,
): Promise<DealSummary | { error: string } | null> {
  const existing = await prisma.deal.findUnique({ where: { id }, select: { stage: true } });
  if (!existing) return null;

  const data: Record<string, unknown> = {};

  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (!title) return { error: 'Deal title is required' };
    data.title = title;
  }
  if (patch.stage !== undefined) {
    if (!isStage(patch.stage)) return { error: 'Invalid stage' };
    if (patch.stage !== existing.stage) {
      data.stage = patch.stage;
      data.stageChangedAt = new Date();
    }
  }
  if (patch.value !== undefined) {
    if (!Number.isFinite(patch.value) || patch.value < 0) return { error: 'Invalid deal value' };
    data.value = patch.value;
  }
  if (patch.currency !== undefined) data.currency = patch.currency.trim() || 'USD';
  if (patch.quoteId !== undefined) data.quoteId = patch.quoteId;
  if (patch.contractId !== undefined) data.contractId = patch.contractId;
  if (patch.signatureStatus !== undefined) {
    if (!(SIGNATURE_STATUSES as readonly string[]).includes(patch.signatureStatus)) {
      return { error: 'Invalid signature status' };
    }
    data.signatureStatus = patch.signatureStatus;
  }
  if (patch.expectedCloseDate !== undefined) {
    data.expectedCloseDate = patch.expectedCloseDate ? new Date(patch.expectedCloseDate) : null;
  }
  if (patch.lostReason !== undefined) data.lostReason = patch.lostReason?.trim() || null;
  if (patch.notes !== undefined) data.notes = patch.notes?.trim() || null;

  const row = await prisma.deal.update({ where: { id }, data, include: DEAL_INCLUDE });
  return serializeDeal(row);
}

export async function deleteDeal(id: number): Promise<boolean> {
  const existing = await prisma.deal.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return false;
  await prisma.deal.delete({ where: { id } });
  return true;
}

export interface CreateActivityInput {
  customerId: number;
  dealId?: number | null;
  contactId?: number | null;
  type: string;
  summary: string;
  occurredAt?: string | null;
}

export async function createActivity(
  userId: number,
  input: CreateActivityInput,
): Promise<CrmActivitySummary | { error: string }> {
  const summary = input.summary?.trim();
  if (!summary) return { error: 'Activity summary is required' };
  if (!(ACTIVITY_TYPES as readonly string[]).includes(input.type)) {
    return { error: 'Invalid activity type' };
  }

  const customer = await prisma.customer.findUnique({ where: { id: input.customerId }, select: { id: true } });
  if (!customer) return { error: 'Customer not found' };

  const row = await prisma.crmActivity.create({
    data: {
      customerId: input.customerId,
      dealId: input.dealId ?? null,
      contactId: input.contactId ?? null,
      type: input.type,
      summary,
      occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
      createdById: userId,
    },
    include: {
      contact: { select: { name: true } },
      createdBy: { select: { name: true } },
    },
  });
  return {
    id: row.id,
    customerId: row.customerId,
    dealId: row.dealId,
    contactId: row.contactId,
    contactName: row.contact?.name ?? null,
    type: row.type as ActivityType,
    summary: row.summary,
    occurredAt: row.occurredAt.toISOString(),
    createdBy: row.createdBy.name,
  };
}

export interface UpdateCrmCustomerInput {
  name?: string;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  address?: string | null;
  billingAddress?: string | null;
  entity?: string;
}

export async function updateCrmCustomer(
  id: number,
  patch: UpdateCrmCustomerInput,
): Promise<CrmCustomer | { error: string } | null> {
  const existing = await prisma.customer.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return null;

  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) return { error: 'Customer name is required' };
    data.name = name;
  }
  if (patch.email !== undefined) data.email = patch.email?.trim() || null;
  if (patch.phone !== undefined) data.phone = patch.phone?.trim() || null;
  if (patch.company !== undefined) data.company = patch.company?.trim() || null;
  if (patch.address !== undefined) data.address = patch.address?.trim() || null;
  if (patch.billingAddress !== undefined) data.billingAddress = patch.billingAddress?.trim() || null;
  if (patch.entity !== undefined) {
    if (!isEntity(patch.entity)) return { error: 'Invalid entity' };
    data.entity = patch.entity;
  }

  await prisma.customer.update({ where: { id }, data });

  const rows = await listCrmCustomers();
  return rows.find((row) => row.id === id) ?? null;
}
