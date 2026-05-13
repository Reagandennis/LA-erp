import 'server-only';

import { Prisma } from '@prisma/client';

import { prisma } from './prisma';

export type QuoteStatus =
  | 'Draft'
  | 'Submitted'
  | 'Approved'
  | 'Declined'
  | 'Sent'
  | 'Expired';

export const QUOTE_STATUSES: QuoteStatus[] = [
  'Draft',
  'Submitted',
  'Approved',
  'Declined',
  'Sent',
  'Expired',
];

export interface QuoteItemDraft {
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface QuoteItemSummary {
  id: number;
  position: number;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface QuoteSummary {
  id: number;
  reference: string;
  subject: string;
  status: QuoteStatus;
  issueDate: string;
  expiryDate: string;
  taxRate: number;
  subtotal: number;
  total: number;
  notes: string | null;
  decisionNote: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
  customer: {
    id: number;
    name: string;
    company: string | null;
    email: string | null;
  };
  createdBy: { id: number; name: string; email: string };
  approver: { id: number; name: string; email: string } | null;
  itemCount: number;
}

export interface QuoteDetail extends QuoteSummary {
  items: QuoteItemSummary[];
}

interface QuoteRecord {
  id: number;
  reference: string;
  customerId: number;
  createdById: number;
  approverId: number | null;
  subject: string;
  status: string;
  issueDate: Date;
  expiryDate: Date;
  taxRate: Prisma.Decimal;
  subtotal: Prisma.Decimal;
  total: Prisma.Decimal;
  notes: string | null;
  decisionNote: string | null;
  submittedAt: Date | null;
  decidedAt: Date | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  customer: {
    id: number;
    name: string;
    company: string | null;
    email: string | null;
  };
  createdBy: { id: number; name: string; email: string };
  approver: { id: number; name: string; email: string } | null;
  items: QuoteItemRecord[];
  _count?: { items: number };
}

interface QuoteItemRecord {
  id: number;
  position: number;
  description: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  total: Prisma.Decimal;
}

const quoteInclude = {
  customer: { select: { id: true, name: true, company: true, email: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  approver: { select: { id: true, name: true, email: true } },
  items: { orderBy: { position: 'asc' as const } },
};

type QuoteCollectionClient = {
  findMany: (args: {
    where?: unknown;
    include?: typeof quoteInclude;
    orderBy?: Array<{ createdAt?: 'asc' | 'desc'; updatedAt?: 'asc' | 'desc' }>;
  }) => Promise<QuoteRecord[]>;
  findUnique: (args: {
    where: { id: number };
    include?: typeof quoteInclude;
  }) => Promise<QuoteRecord | null>;
  create: (args: {
    data: Record<string, unknown>;
    include?: typeof quoteInclude;
  }) => Promise<QuoteRecord>;
  update: (args: {
    where: { id: number };
    data: Record<string, unknown>;
    include?: typeof quoteInclude;
  }) => Promise<QuoteRecord>;
  delete: (args: { where: { id: number } }) => Promise<QuoteRecord>;
  count: (args: { where: { reference: { startsWith: string } } }) => Promise<number>;
};

type QuoteItemCollectionClient = {
  deleteMany: (args: { where: { quoteId: number } }) => Promise<{ count: number }>;
  createMany: (args: {
    data: Array<{
      quoteId: number;
      position: number;
      description: string;
      quantity: Prisma.Decimal;
      unitPrice: Prisma.Decimal;
      total: Prisma.Decimal;
    }>;
  }) => Promise<{ count: number }>;
};

type QuoteNotificationCollectionClient = {
  createMany: (args: {
    data: Array<{
      userId: number;
      quoteId: number;
      type: string;
      message: string;
    }>;
  }) => Promise<{ count: number }>;
};

const quoteClient = (
  prisma as unknown as { quote: QuoteCollectionClient }
).quote;
const quoteNotificationClient = (
  prisma as unknown as { quoteNotification: QuoteNotificationCollectionClient }
).quoteNotification;

function toNumber(value: Prisma.Decimal | number): number {
  if (typeof value === 'number') {
    return value;
  }
  return Number(value.toString());
}

function serializeItem(item: QuoteItemRecord): QuoteItemSummary {
  return {
    id: item.id,
    position: item.position,
    description: item.description,
    quantity: toNumber(item.quantity),
    unitPrice: toNumber(item.unitPrice),
    total: toNumber(item.total),
  };
}

function serializeSummary(record: QuoteRecord): QuoteSummary {
  return {
    id: record.id,
    reference: record.reference,
    subject: record.subject,
    status: record.status as QuoteStatus,
    issueDate: record.issueDate.toISOString(),
    expiryDate: record.expiryDate.toISOString(),
    taxRate: toNumber(record.taxRate),
    subtotal: toNumber(record.subtotal),
    total: toNumber(record.total),
    notes: record.notes,
    decisionNote: record.decisionNote,
    submittedAt: record.submittedAt?.toISOString() ?? null,
    decidedAt: record.decidedAt?.toISOString() ?? null,
    sentAt: record.sentAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    customer: record.customer,
    createdBy: record.createdBy,
    approver: record.approver,
    itemCount: record._count?.items ?? record.items?.length ?? 0,
  };
}

function serializeDetail(record: QuoteRecord): QuoteDetail {
  return {
    ...serializeSummary(record),
    items: record.items.map(serializeItem),
  };
}

function computeItemTotals(items: QuoteItemDraft[], taxRate: number) {
  let subtotal = new Prisma.Decimal(0);
  const prepared = items.map((item, index) => {
    const quantity = new Prisma.Decimal(item.quantity);
    const unitPrice = new Prisma.Decimal(item.unitPrice);
    const total = quantity.mul(unitPrice);
    subtotal = subtotal.add(total);
    return {
      position: index,
      description: item.description,
      quantity,
      unitPrice,
      total,
    };
  });

  const tax = subtotal.mul(new Prisma.Decimal(taxRate));
  const total = subtotal.add(tax);

  return { items: prepared, subtotal, total };
}

export async function nextReference(year = new Date().getUTCFullYear()): Promise<string> {
  const prefix = `QT-${year}-`;
  const existing = await quoteClient.count({
    where: { reference: { startsWith: prefix } },
  });
  const sequence = String(existing + 1).padStart(4, '0');
  return `${prefix}${sequence}`;
}

function buildAccessFilter(userId: number, isAdmin: boolean) {
  if (isAdmin) {
    return {};
  }
  return {
    OR: [{ createdById: userId }, { approverId: userId }],
  };
}

export async function listQuotesForUser(params: {
  userId: number;
  isAdmin: boolean;
}): Promise<QuoteSummary[]> {
  const records = await quoteClient.findMany({
    where: buildAccessFilter(params.userId, params.isAdmin),
    include: quoteInclude,
    orderBy: [{ updatedAt: 'desc' }],
  });
  return records.map(serializeSummary);
}

export async function getQuoteForUser(params: {
  id: number;
  userId: number;
  isAdmin: boolean;
}): Promise<QuoteDetail | null> {
  const record = await quoteClient.findUnique({
    where: { id: params.id },
    include: quoteInclude,
  });

  if (!record) {
    return null;
  }

  const isParticipant =
    params.isAdmin ||
    record.createdById === params.userId ||
    record.approverId === params.userId;

  if (!isParticipant) {
    return null;
  }

  return serializeDetail(record);
}

export interface QuoteCreateInput {
  customerId: number;
  approverId: number | null;
  subject: string;
  issueDate: string;
  expiryDate: string;
  taxRate: number;
  notes: string | null;
  items: QuoteItemDraft[];
  createdById: number;
}

export async function createQuote(input: QuoteCreateInput): Promise<QuoteDetail> {
  const reference = await nextReference();
  const totals = computeItemTotals(input.items, input.taxRate);

  return prisma.$transaction(async (tx) => {
    const txQuote = (
      tx as unknown as { quote: QuoteCollectionClient }
    ).quote;
    const txItem = (
      tx as unknown as { quoteItem: QuoteItemCollectionClient }
    ).quoteItem;

    const created = await txQuote.create({
      data: {
        reference,
        customerId: input.customerId,
        createdById: input.createdById,
        approverId: input.approverId,
        subject: input.subject,
        status: 'Draft',
        issueDate: new Date(input.issueDate),
        expiryDate: new Date(input.expiryDate),
        taxRate: new Prisma.Decimal(input.taxRate),
        subtotal: totals.subtotal,
        total: totals.total,
        notes: input.notes,
      },
      include: quoteInclude,
    });

    if (totals.items.length > 0) {
      await txItem.createMany({
        data: totals.items.map((item) => ({
          quoteId: created.id,
          position: item.position,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: item.total,
        })),
      });
    }

    const fresh = await txQuote.findUnique({
      where: { id: created.id },
      include: quoteInclude,
    });

    return serializeDetail(fresh!);
  });
}

export interface QuoteUpdateInput {
  customerId?: number;
  approverId?: number | null;
  subject?: string;
  issueDate?: string;
  expiryDate?: string;
  taxRate?: number;
  notes?: string | null;
  items?: QuoteItemDraft[];
}

export async function updateDraftQuote(params: {
  id: number;
  userId: number;
  isAdmin: boolean;
  input: QuoteUpdateInput;
}): Promise<QuoteDetail | { error: string }> {
  const existing = await quoteClient.findUnique({
    where: { id: params.id },
    include: quoteInclude,
  });

  if (!existing) {
    return { error: 'Quote not found' };
  }

  if (!params.isAdmin && existing.createdById !== params.userId) {
    return { error: 'You cannot edit this quote' };
  }

  if (existing.status !== 'Draft' && existing.status !== 'Declined') {
    return { error: `Cannot edit a quote in status "${existing.status}"` };
  }

  const taxRate = params.input.taxRate ?? toNumber(existing.taxRate);
  const items =
    params.input.items ??
    existing.items.map((item) => ({
      description: item.description,
      quantity: toNumber(item.quantity),
      unitPrice: toNumber(item.unitPrice),
    }));
  const totals = computeItemTotals(items, taxRate);

  return prisma.$transaction(async (tx) => {
    const txQuote = (
      tx as unknown as { quote: QuoteCollectionClient }
    ).quote;
    const txItem = (
      tx as unknown as { quoteItem: QuoteItemCollectionClient }
    ).quoteItem;

    await txQuote.update({
      where: { id: params.id },
      data: {
        customerId: params.input.customerId ?? existing.customerId,
        approverId:
          params.input.approverId === undefined
            ? existing.approverId
            : params.input.approverId,
        subject: params.input.subject ?? existing.subject,
        issueDate:
          params.input.issueDate !== undefined
            ? new Date(params.input.issueDate)
            : existing.issueDate,
        expiryDate:
          params.input.expiryDate !== undefined
            ? new Date(params.input.expiryDate)
            : existing.expiryDate,
        taxRate: new Prisma.Decimal(taxRate),
        notes: params.input.notes === undefined ? existing.notes : params.input.notes,
        subtotal: totals.subtotal,
        total: totals.total,
        // editing a Declined quote returns it to Draft
        status: existing.status === 'Declined' ? 'Draft' : existing.status,
        decisionNote: existing.status === 'Declined' ? null : existing.decisionNote,
        decidedAt: existing.status === 'Declined' ? null : existing.decidedAt,
      },
    });

    if (params.input.items) {
      await txItem.deleteMany({ where: { quoteId: params.id } });
      await txItem.createMany({
        data: totals.items.map((item) => ({
          quoteId: params.id,
          position: item.position,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: item.total,
        })),
      });
    }

    const fresh = await txQuote.findUnique({
      where: { id: params.id },
      include: quoteInclude,
    });
    return serializeDetail(fresh!);
  });
}

export async function submitQuote(params: {
  id: number;
  userId: number;
  isAdmin: boolean;
}): Promise<QuoteDetail | { error: string }> {
  const existing = await quoteClient.findUnique({
    where: { id: params.id },
    include: quoteInclude,
  });

  if (!existing) {
    return { error: 'Quote not found' };
  }

  if (!params.isAdmin && existing.createdById !== params.userId) {
    return { error: 'You cannot submit this quote' };
  }

  if (existing.status !== 'Draft' && existing.status !== 'Declined') {
    return { error: `Cannot submit a quote in status "${existing.status}"` };
  }

  if (!existing.approverId) {
    return { error: 'Assign an approver before submitting' };
  }

  await quoteClient.update({
    where: { id: params.id },
    data: {
      status: 'Submitted',
      submittedAt: new Date(),
      decisionNote: null,
      decidedAt: null,
    },
  });

  await quoteNotificationClient.createMany({
    data: [
      {
        userId: existing.approverId,
        quoteId: existing.id,
        type: 'quote.submitted',
        message: `${existing.createdBy.name} submitted quote ${existing.reference} for your approval`,
      },
    ],
  });

  const refreshed = await quoteClient.findUnique({
    where: { id: params.id },
    include: quoteInclude,
  });
  return serializeDetail(refreshed!);
}

export async function decideQuote(params: {
  id: number;
  userId: number;
  isAdmin: boolean;
  decision: 'approved' | 'declined';
  note: string | null;
}): Promise<QuoteDetail | { error: string }> {
  const existing = await quoteClient.findUnique({
    where: { id: params.id },
    include: quoteInclude,
  });

  if (!existing) {
    return { error: 'Quote not found' };
  }

  if (existing.status !== 'Submitted') {
    return { error: `Cannot decide a quote in status "${existing.status}"` };
  }

  const isApprover = existing.approverId === params.userId;
  if (!isApprover && !params.isAdmin) {
    return { error: 'Only the assigned approver can decide this quote' };
  }

  const newStatus = params.decision === 'approved' ? 'Approved' : 'Declined';

  await quoteClient.update({
    where: { id: params.id },
    data: {
      status: newStatus,
      decisionNote: params.note,
      decidedAt: new Date(),
    },
  });

  await quoteNotificationClient.createMany({
    data: [
      {
        userId: existing.createdById,
        quoteId: existing.id,
        type: params.decision === 'approved' ? 'quote.approved' : 'quote.declined',
        message:
          params.decision === 'approved'
            ? `Quote ${existing.reference} was approved`
            : `Quote ${existing.reference} was declined`,
      },
    ],
  });

  const refreshed = await quoteClient.findUnique({
    where: { id: params.id },
    include: quoteInclude,
  });
  return serializeDetail(refreshed!);
}

export async function markQuoteSent(params: {
  id: number;
  userId: number;
  isAdmin: boolean;
}): Promise<QuoteDetail | { error: string }> {
  const existing = await quoteClient.findUnique({
    where: { id: params.id },
    include: quoteInclude,
  });

  if (!existing) {
    return { error: 'Quote not found' };
  }

  if (!params.isAdmin && existing.createdById !== params.userId) {
    return { error: 'Only the creator can dispatch this quote' };
  }

  if (existing.status !== 'Approved') {
    return { error: 'Only approved quotes can be marked as sent' };
  }

  await quoteClient.update({
    where: { id: params.id },
    data: { status: 'Sent', sentAt: new Date() },
  });

  const refreshed = await quoteClient.findUnique({
    where: { id: params.id },
    include: quoteInclude,
  });
  return serializeDetail(refreshed!);
}

export async function deleteQuote(params: {
  id: number;
  userId: number;
  isAdmin: boolean;
}): Promise<true | { error: string }> {
  const existing = await quoteClient.findUnique({
    where: { id: params.id },
    include: quoteInclude,
  });

  if (!existing) {
    return { error: 'Quote not found' };
  }

  if (!params.isAdmin && existing.createdById !== params.userId) {
    return { error: 'Only the creator can delete this quote' };
  }

  if (existing.status !== 'Draft' && existing.status !== 'Declined') {
    return { error: `Cannot delete a quote in status "${existing.status}"` };
  }

  await quoteClient.delete({ where: { id: params.id } });
  return true;
}

export interface QuoteNotificationSummary {
  id: number;
  quoteId: number;
  type: string;
  message: string;
  createdAt: string;
  readAt: string | null;
}

interface NotificationRow {
  id: number;
  quoteId: number;
  type: string;
  message: string;
  createdAt: Date;
  readAt: Date | null;
}

export async function listQuoteNotifications(userId: number): Promise<QuoteNotificationSummary[]> {
  const rows = await prisma.$queryRaw<NotificationRow[]>`
    SELECT "id", "quoteId", "type", "message", "createdAt", "readAt"
    FROM "QuoteNotification"
    WHERE "userId" = ${userId}
    ORDER BY "createdAt" DESC
    LIMIT 20
  `;

  return rows.map((row) => ({
    id: row.id,
    quoteId: row.quoteId,
    type: row.type,
    message: row.message,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
  }));
}

export async function markQuoteNotificationsRead(userId: number, ids: number[]): Promise<number> {
  const normalized = Array.from(
    new Set(ids.filter((id) => Number.isInteger(id) && id > 0)),
  );
  if (normalized.length === 0) {
    return 0;
  }

  return prisma.$executeRaw`
    UPDATE "QuoteNotification"
    SET "readAt" = NOW()
    WHERE "userId" = ${userId} AND "id" IN (${Prisma.join(normalized)})
  `;
}

export async function listApproverCandidates(excludeUserId: number) {
  const users = await prisma.user.findMany({
    where: {
      status: 'active',
      id: { not: excludeUserId },
    },
    select: { id: true, name: true, email: true },
    orderBy: { name: 'asc' },
  });
  return users;
}
