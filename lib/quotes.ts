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

export type DiscountType = 'none' | 'percentage' | 'fixed';

export interface QuoteItemDraft {
  description: string;
  quantity: number;
  unitPrice: number;
  taxable?: boolean;
  discountType?: DiscountType;
  discountValue?: number;
  productId?: number | null;
}

export interface QuoteItemSummary {
  id: number;
  position: number;
  description: string;
  quantity: number;
  unitPrice: number;
  taxable: boolean;
  discountType: DiscountType;
  discountValue: number;
  discountAmount: number;
  total: number;
  productId: number | null;
}

export interface QuoteTripSummary {
  id: number;
  reference: string;
  trackingCode: string;
  status: string;
}

export interface QuoteSummary {
  id: number;
  reference: string;
  trackingCode: string | null;
  subject: string;
  status: QuoteStatus;
  issueDate: string;
  expiryDate: string;
  currency: string;
  taxRate: number;
  discountType: DiscountType;
  discountValue: number;
  discountAmount: number;
  subtotal: number;
  tax: number;
  total: number;
  notes: string | null;
  terms: string | null;
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
  brandProfile: { id: number; name: string; companyName: string | null; primaryColor: string } | null;
  itemCount: number;
  trip: QuoteTripSummary | null;
}

export interface QuoteDetail extends QuoteSummary {
  items: QuoteItemSummary[];
}

interface QuoteRecord {
  id: number;
  reference: string;
  trackingCode: string | null;
  customerId: number;
  createdById: number;
  approverId: number | null;
  brandProfileId: number | null;
  subject: string;
  status: string;
  issueDate: Date;
  expiryDate: Date;
  currency: string;
  taxRate: Prisma.Decimal;
  discountType: string;
  discountValue: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  subtotal: Prisma.Decimal;
  tax: Prisma.Decimal;
  total: Prisma.Decimal;
  notes: string | null;
  terms: string | null;
  decisionNote: string | null;
  submittedAt: Date | null;
  decidedAt: Date | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  customer: { id: number; name: string; company: string | null; email: string | null };
  createdBy: { id: number; name: string; email: string };
  approver: { id: number; name: string; email: string } | null;
  brandProfile: { id: number; name: string; companyName: string | null; primaryColor: string } | null;
  items: QuoteItemRecord[];
  trip: { id: number; reference: string; trackingCode: string; status: string } | null;
}

interface QuoteItemRecord {
  id: number;
  position: number;
  description: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  taxable: boolean;
  discountType: string;
  discountValue: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  total: Prisma.Decimal;
  productId: number | null;
}

const quoteInclude = {
  customer: { select: { id: true, name: true, company: true, email: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  approver: { select: { id: true, name: true, email: true } },
  brandProfile: { select: { id: true, name: true, companyName: true, primaryColor: true } },
  items: { orderBy: { position: 'asc' as const } },
  trip: { select: { id: true, reference: true, trackingCode: true, status: true } },
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
      taxable: boolean;
      discountType: string;
      discountValue: Prisma.Decimal;
      discountAmount: Prisma.Decimal;
      total: Prisma.Decimal;
      productId: number | null;
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

type QuoteSequenceCollectionClient = {
  upsert: (args: {
    where: { year: number };
    create: { year: number; lastNumber: number };
    update: { lastNumber: { increment: number } };
  }) => Promise<{ year: number; lastNumber: number }>;
};

function getQuoteClient(): QuoteCollectionClient {
  return (prisma as unknown as { quote: QuoteCollectionClient }).quote;
}

function getQuoteNotificationClient(): QuoteNotificationCollectionClient {
  return (prisma as unknown as { quoteNotification: QuoteNotificationCollectionClient })
    .quoteNotification;
}

function txClients(tx: unknown) {
  const handle = tx as unknown as {
    quote: QuoteCollectionClient;
    quoteItem: QuoteItemCollectionClient;
    quoteSequence: QuoteSequenceCollectionClient;
  };
  return { quote: handle.quote, quoteItem: handle.quoteItem, quoteSequence: handle.quoteSequence };
}

function toNumber(value: Prisma.Decimal | number): number {
  if (typeof value === 'number') return value;
  return Number(value.toString());
}

const ZERO = new Prisma.Decimal(0);

function asDecimal(value: number | Prisma.Decimal): Prisma.Decimal {
  if (value instanceof Prisma.Decimal) return value;
  return new Prisma.Decimal(value);
}

function round2(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

function clampDiscount(amount: Prisma.Decimal, max: Prisma.Decimal): Prisma.Decimal {
  if (amount.lessThan(ZERO)) return ZERO;
  if (amount.greaterThan(max)) return max;
  return amount;
}

function computeLine(item: QuoteItemDraft) {
  const quantity = asDecimal(item.quantity);
  const unitPrice = asDecimal(item.unitPrice);
  const gross = quantity.mul(unitPrice);
  const discountType = (item.discountType ?? 'none') as DiscountType;
  const discountValue = asDecimal(item.discountValue ?? 0);
  let discountAmount = ZERO;
  if (discountType === 'percentage') {
    discountAmount = gross.mul(discountValue).div(100);
  } else if (discountType === 'fixed') {
    discountAmount = discountValue;
  }
  discountAmount = clampDiscount(round2(discountAmount), round2(gross));
  const total = round2(gross.sub(discountAmount));
  return {
    quantity,
    unitPrice,
    taxable: item.taxable ?? true,
    discountType,
    discountValue: round2(discountValue),
    discountAmount,
    total,
  };
}

interface ComputedTotals {
  items: Array<ReturnType<typeof computeLine> & { description: string; productId: number | null; position: number }>;
  subtotal: Prisma.Decimal;
  tax: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  total: Prisma.Decimal;
}

export function computeQuoteTotals(input: {
  items: QuoteItemDraft[];
  taxRate: number;
  discountType: DiscountType;
  discountValue: number;
}): ComputedTotals {
  const lines = input.items.map((item, index) => ({
    ...computeLine(item),
    description: item.description,
    productId: item.productId ?? null,
    position: index,
  }));

  const subtotal = round2(
    lines.reduce<Prisma.Decimal>((acc, line) => acc.add(line.total), ZERO),
  );
  const taxableSubtotal = lines.reduce<Prisma.Decimal>(
    (acc, line) => (line.taxable ? acc.add(line.total) : acc),
    ZERO,
  );
  const tax = round2(taxableSubtotal.mul(asDecimal(input.taxRate)));

  const preDiscount = round2(subtotal.add(tax));
  let discountAmount = ZERO;
  if (input.discountType === 'percentage') {
    discountAmount = preDiscount.mul(asDecimal(input.discountValue)).div(100);
  } else if (input.discountType === 'fixed') {
    discountAmount = asDecimal(input.discountValue);
  }
  discountAmount = clampDiscount(round2(discountAmount), preDiscount);
  const total = round2(preDiscount.sub(discountAmount));

  return { items: lines, subtotal, tax, discountAmount, total };
}

function serializeItem(item: QuoteItemRecord): QuoteItemSummary {
  return {
    id: item.id,
    position: item.position,
    description: item.description,
    quantity: toNumber(item.quantity),
    unitPrice: toNumber(item.unitPrice),
    taxable: item.taxable,
    discountType: item.discountType as DiscountType,
    discountValue: toNumber(item.discountValue),
    discountAmount: toNumber(item.discountAmount),
    total: toNumber(item.total),
    productId: item.productId,
  };
}

function serializeSummary(record: QuoteRecord): QuoteSummary {
  return {
    id: record.id,
    reference: record.reference,
    trackingCode: record.trackingCode,
    subject: record.subject,
    status: record.status as QuoteStatus,
    issueDate: record.issueDate.toISOString(),
    expiryDate: record.expiryDate.toISOString(),
    currency: record.currency,
    taxRate: toNumber(record.taxRate),
    discountType: record.discountType as DiscountType,
    discountValue: toNumber(record.discountValue),
    discountAmount: toNumber(record.discountAmount),
    subtotal: toNumber(record.subtotal),
    tax: toNumber(record.tax),
    total: toNumber(record.total),
    notes: record.notes,
    terms: record.terms,
    decisionNote: record.decisionNote,
    submittedAt: record.submittedAt?.toISOString() ?? null,
    decidedAt: record.decidedAt?.toISOString() ?? null,
    sentAt: record.sentAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    customer: record.customer,
    createdBy: record.createdBy,
    approver: record.approver,
    brandProfile: record.brandProfile,
    itemCount: record.items?.length ?? 0,
    trip: record.trip,
  };
}

function serializeDetail(record: QuoteRecord): QuoteDetail {
  return { ...serializeSummary(record), items: record.items.map(serializeItem) };
}

async function reserveSequenceReference(
  txClient: QuoteSequenceCollectionClient,
  year: number,
): Promise<string> {
  const next = await txClient.upsert({
    where: { year },
    create: { year, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
  });
  return `QT-${year}-${String(next.lastNumber).padStart(4, '0')}`;
}

function buildAccessFilter(userId: number, isAdmin: boolean) {
  if (isAdmin) return {};
  return { OR: [{ createdById: userId }, { approverId: userId }] };
}

export async function listQuotesForUser(params: {
  userId: number;
  isAdmin: boolean;
}): Promise<QuoteSummary[]> {
  const records = await getQuoteClient().findMany({
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
  const record = await getQuoteClient().findUnique({
    where: { id: params.id },
    include: quoteInclude,
  });
  if (!record) return null;
  const isParticipant =
    params.isAdmin || record.createdById === params.userId || record.approverId === params.userId;
  if (!isParticipant) return null;
  return serializeDetail(record);
}

export interface QuoteCreateInput {
  customerId: number;
  approverId: number | null;
  brandProfileId: number | null;
  subject: string;
  issueDate: string;
  expiryDate: string;
  currency: string;
  taxRate: number;
  discountType: DiscountType;
  discountValue: number;
  notes: string | null;
  terms: string | null;
  items: QuoteItemDraft[];
  createdById: number;
}

export async function createQuote(input: QuoteCreateInput): Promise<QuoteDetail> {
  const totals = computeQuoteTotals({
    items: input.items,
    taxRate: input.taxRate,
    discountType: input.discountType,
    discountValue: input.discountValue,
  });
  const year = new Date(input.issueDate).getUTCFullYear();

  return prisma.$transaction(async (tx) => {
    const { quote, quoteItem, quoteSequence } = txClients(tx);
    const reference = await reserveSequenceReference(quoteSequence, year);

    const created = await quote.create({
      data: {
        reference,
        customerId: input.customerId,
        createdById: input.createdById,
        approverId: input.approverId,
        brandProfileId: input.brandProfileId,
        subject: input.subject,
        status: 'Draft',
        issueDate: new Date(input.issueDate),
        expiryDate: new Date(input.expiryDate),
        currency: input.currency,
        taxRate: asDecimal(input.taxRate),
        discountType: input.discountType,
        discountValue: asDecimal(input.discountValue),
        discountAmount: totals.discountAmount,
        subtotal: totals.subtotal,
        tax: totals.tax,
        total: totals.total,
        notes: input.notes,
        terms: input.terms,
      },
      include: quoteInclude,
    });

    if (totals.items.length > 0) {
      await quoteItem.createMany({
        data: totals.items.map((item) => ({
          quoteId: created.id,
          position: item.position,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          taxable: item.taxable,
          discountType: item.discountType,
          discountValue: item.discountValue,
          discountAmount: item.discountAmount,
          total: item.total,
          productId: item.productId,
        })),
      });
    }

    const fresh = await quote.findUnique({ where: { id: created.id }, include: quoteInclude });
    return serializeDetail(fresh!);
  });
}

export interface QuoteUpdateInput {
  customerId?: number;
  approverId?: number | null;
  brandProfileId?: number | null;
  subject?: string;
  issueDate?: string;
  expiryDate?: string;
  currency?: string;
  taxRate?: number;
  discountType?: DiscountType;
  discountValue?: number;
  notes?: string | null;
  terms?: string | null;
  items?: QuoteItemDraft[];
}

function canEditQuote(record: QuoteRecord, userId: number, isAdmin: boolean): boolean {
  if (isAdmin) return true;
  if (record.status === 'Draft' || record.status === 'Declined') {
    return record.createdById === userId;
  }
  // Lock-after-approved override: assigned approver can revise an Approved quote
  if (record.status === 'Approved') {
    return record.approverId === userId;
  }
  return false;
}

export async function updateDraftQuote(params: {
  id: number;
  userId: number;
  isAdmin: boolean;
  input: QuoteUpdateInput;
}): Promise<QuoteDetail | { error: string }> {
  const existing = await getQuoteClient().findUnique({
    where: { id: params.id },
    include: quoteInclude,
  });
  if (!existing) return { error: 'Quote not found' };
  if (!canEditQuote(existing, params.userId, params.isAdmin)) {
    return { error: `Cannot edit a quote in status "${existing.status}"` };
  }

  const taxRate = params.input.taxRate ?? toNumber(existing.taxRate);
  const discountType = (params.input.discountType ?? existing.discountType) as DiscountType;
  const discountValue =
    params.input.discountValue ?? toNumber(existing.discountValue);
  const items =
    params.input.items ??
    existing.items.map<QuoteItemDraft>((item) => ({
      description: item.description,
      quantity: toNumber(item.quantity),
      unitPrice: toNumber(item.unitPrice),
      taxable: item.taxable,
      discountType: item.discountType as DiscountType,
      discountValue: toNumber(item.discountValue),
      productId: item.productId,
    }));

  const totals = computeQuoteTotals({ items, taxRate, discountType, discountValue });

  return prisma.$transaction(async (tx) => {
    const { quote, quoteItem } = txClients(tx);

    const wasDeclined = existing.status === 'Declined';

    await quote.update({
      where: { id: params.id },
      data: {
        customerId: params.input.customerId ?? existing.customerId,
        approverId:
          params.input.approverId === undefined ? existing.approverId : params.input.approverId,
        brandProfileId:
          params.input.brandProfileId === undefined
            ? existing.brandProfileId
            : params.input.brandProfileId,
        subject: params.input.subject ?? existing.subject,
        issueDate:
          params.input.issueDate !== undefined ? new Date(params.input.issueDate) : existing.issueDate,
        expiryDate:
          params.input.expiryDate !== undefined ? new Date(params.input.expiryDate) : existing.expiryDate,
        currency: params.input.currency ?? existing.currency,
        taxRate: asDecimal(taxRate),
        discountType,
        discountValue: asDecimal(discountValue),
        discountAmount: totals.discountAmount,
        subtotal: totals.subtotal,
        tax: totals.tax,
        total: totals.total,
        notes: params.input.notes === undefined ? existing.notes : params.input.notes,
        terms: params.input.terms === undefined ? existing.terms : params.input.terms,
        // Editing a Declined quote returns it to Draft; editing an Approved one keeps Approved
        status: wasDeclined ? 'Draft' : existing.status,
        decisionNote: wasDeclined ? null : existing.decisionNote,
        decidedAt: wasDeclined ? null : existing.decidedAt,
      },
    });

    if (params.input.items) {
      await quoteItem.deleteMany({ where: { quoteId: params.id } });
      await quoteItem.createMany({
        data: totals.items.map((item) => ({
          quoteId: params.id,
          position: item.position,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          taxable: item.taxable,
          discountType: item.discountType,
          discountValue: item.discountValue,
          discountAmount: item.discountAmount,
          total: item.total,
          productId: item.productId,
        })),
      });
    }

    const fresh = await quote.findUnique({ where: { id: params.id }, include: quoteInclude });
    return serializeDetail(fresh!);
  });
}

export async function submitQuote(params: {
  id: number;
  userId: number;
  isAdmin: boolean;
}): Promise<QuoteDetail | { error: string }> {
  const existing = await getQuoteClient().findUnique({
    where: { id: params.id },
    include: quoteInclude,
  });
  if (!existing) return { error: 'Quote not found' };
  if (!params.isAdmin && existing.createdById !== params.userId) {
    return { error: 'You cannot submit this quote' };
  }
  if (existing.status !== 'Draft' && existing.status !== 'Declined') {
    return { error: `Cannot submit a quote in status "${existing.status}"` };
  }
  if (!existing.approverId) {
    return { error: 'Assign an approver before submitting' };
  }

  await getQuoteClient().update({
    where: { id: params.id },
    data: { status: 'Submitted', submittedAt: new Date(), decisionNote: null, decidedAt: null },
  });

  await getQuoteNotificationClient().createMany({
    data: [
      {
        userId: existing.approverId,
        quoteId: existing.id,
        type: 'quote.submitted',
        message: `${existing.createdBy.name} submitted quote ${existing.reference} for your approval`,
      },
    ],
  });

  const refreshed = await getQuoteClient().findUnique({
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
  const existing = await getQuoteClient().findUnique({
    where: { id: params.id },
    include: quoteInclude,
  });
  if (!existing) return { error: 'Quote not found' };
  if (existing.status !== 'Submitted') {
    return { error: `Cannot decide a quote in status "${existing.status}"` };
  }
  const isApprover = existing.approverId === params.userId;
  if (!isApprover && !params.isAdmin) {
    return { error: 'Only the assigned approver can decide this quote' };
  }

  const newStatus = params.decision === 'approved' ? 'Approved' : 'Declined';
  await getQuoteClient().update({
    where: { id: params.id },
    data: { status: newStatus, decisionNote: params.note, decidedAt: new Date() },
  });

  await getQuoteNotificationClient().createMany({
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

  const refreshed = await getQuoteClient().findUnique({
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
  const existing = await getQuoteClient().findUnique({
    where: { id: params.id },
    include: quoteInclude,
  });
  if (!existing) return { error: 'Quote not found' };
  if (!params.isAdmin && existing.createdById !== params.userId) {
    return { error: 'Only the creator can dispatch this quote' };
  }
  if (existing.status !== 'Approved') {
    return { error: 'Only approved quotes can be marked as sent' };
  }

  await getQuoteClient().update({
    where: { id: params.id },
    data: { status: 'Sent', sentAt: new Date() },
  });

  const refreshed = await getQuoteClient().findUnique({
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
  const existing = await getQuoteClient().findUnique({
    where: { id: params.id },
    include: quoteInclude,
  });
  if (!existing) return { error: 'Quote not found' };
  if (!params.isAdmin && existing.createdById !== params.userId) {
    return { error: 'Only the creator can delete this quote' };
  }
  if (existing.status !== 'Draft' && existing.status !== 'Declined') {
    return { error: `Cannot delete a quote in status "${existing.status}"` };
  }
  await getQuoteClient().delete({ where: { id: params.id } });
  return true;
}

export async function duplicateQuote(params: {
  id: number;
  userId: number;
  isAdmin: boolean;
}): Promise<QuoteDetail | { error: string }> {
  const original = await getQuoteClient().findUnique({
    where: { id: params.id },
    include: quoteInclude,
  });
  if (!original) return { error: 'Quote not found' };
  const isParticipant =
    params.isAdmin ||
    original.createdById === params.userId ||
    original.approverId === params.userId;
  if (!isParticipant) return { error: 'Quote not found' };

  const itemDrafts: QuoteItemDraft[] = original.items.map((item) => ({
    description: item.description,
    quantity: toNumber(item.quantity),
    unitPrice: toNumber(item.unitPrice),
    taxable: item.taxable,
    discountType: item.discountType as DiscountType,
    discountValue: toNumber(item.discountValue),
    productId: item.productId,
  }));

  return createQuote({
    customerId: original.customerId,
    approverId: original.approverId,
    brandProfileId: original.brandProfileId,
    subject: `${original.subject} (copy)`,
    issueDate: new Date().toISOString(),
    expiryDate: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    currency: original.currency,
    taxRate: toNumber(original.taxRate),
    discountType: original.discountType as DiscountType,
    discountValue: toNumber(original.discountValue),
    notes: original.notes,
    terms: original.terms,
    items: itemDrafts,
    createdById: params.userId,
  });
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
  const normalized = Array.from(new Set(ids.filter((id) => Number.isInteger(id) && id > 0)));
  if (normalized.length === 0) return 0;
  return prisma.$executeRaw`
    UPDATE "QuoteNotification"
    SET "readAt" = NOW()
    WHERE "userId" = ${userId} AND "id" IN (${Prisma.join(normalized)})
  `;
}

export async function listApproverCandidates(excludeUserId: number) {
  return prisma.user.findMany({
    where: { status: 'active', id: { not: excludeUserId } },
    select: { id: true, name: true, email: true },
    orderBy: { name: 'asc' },
  });
}
