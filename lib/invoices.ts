import 'server-only';

import { Prisma } from '@prisma/client';

import { prisma } from './prisma';
import { computeQuoteTotals } from './quotes';

export type InvoiceStatus = 'Draft' | 'Sent' | 'Partial' | 'Paid' | 'Void';

export const INVOICE_STATUSES: InvoiceStatus[] = ['Draft', 'Sent', 'Partial', 'Paid', 'Void'];

export const PAYMENT_METHODS = [
  'Bank transfer',
  'Mobile money',
  'Cash',
  'Card',
  'Cheque',
  'Other',
] as const;

export type DiscountType = 'none' | 'percentage' | 'fixed';

export interface InvoiceItemDraft {
  description: string;
  quantity: number;
  unitPrice: number;
  taxable?: boolean;
  discountType?: DiscountType;
  discountValue?: number;
  productId?: number | null;
}

export interface InvoiceItemSummary {
  id: number;
  position: number;
  description: string;
  quantity: number;
  unitPrice: number;
  taxable: boolean;
  total: number;
  productId: number | null;
}

export interface InvoicePaymentSummary {
  id: number;
  amount: number;
  method: string;
  reference: string | null;
  note: string | null;
  paidAt: string;
  recordedBy: { id: number; name: string } | null;
  createdAt: string;
}

export interface InvoiceSummary {
  id: number;
  number: string;
  status: InvoiceStatus;
  isOverdue: boolean;
  issueDate: string;
  dueDate: string;
  currency: string;
  taxRate: number;
  discountType: DiscountType;
  discountValue: number;
  discountAmount: number;
  subtotal: number;
  tax: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  notes: string | null;
  terms: string | null;
  sentAt: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
  customer: { id: number; name: string; company: string | null; email: string | null };
  createdBy: { id: number; name: string; email: string };
  brandProfile: { id: number; name: string; companyName: string | null; primaryColor: string } | null;
  sourceQuote: { id: number; reference: string } | null;
  itemCount: number;
}

export interface InvoiceDetail extends InvoiceSummary {
  items: InvoiceItemSummary[];
  payments: InvoicePaymentSummary[];
}

const invoiceInclude = {
  customer: { select: { id: true, name: true, company: true, email: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  brandProfile: { select: { id: true, name: true, companyName: true, primaryColor: true } },
  sourceQuote: { select: { id: true, reference: true } },
  items: { orderBy: { position: 'asc' } },
  payments: {
    orderBy: { paidAt: 'desc' },
    include: { createdBy: { select: { id: true, name: true } } },
  },
} satisfies Prisma.InvoiceInclude;

type InvoiceRecord = Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>;

function toNumber(value: Prisma.Decimal | number | null): number {
  if (value === null) return 0;
  if (typeof value === 'number') return value;
  return Number(value.toString());
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function isOverdueStatus(status: string, dueDate: Date, balanceDue: number): boolean {
  if (status !== 'Sent' && status !== 'Partial') return false;
  return balanceDue > 0 && dueDate.getTime() < Date.now();
}

function serializeItem(item: InvoiceRecord['items'][number]): InvoiceItemSummary {
  return {
    id: item.id,
    position: item.position,
    description: item.description,
    quantity: toNumber(item.quantity),
    unitPrice: toNumber(item.unitPrice),
    taxable: item.taxable,
    total: toNumber(item.total),
    productId: item.productId,
  };
}

function serializePayment(payment: InvoiceRecord['payments'][number]): InvoicePaymentSummary {
  return {
    id: payment.id,
    amount: toNumber(payment.amount),
    method: payment.method,
    reference: payment.reference,
    note: payment.note,
    paidAt: payment.paidAt.toISOString(),
    recordedBy: payment.createdBy,
    createdAt: payment.createdAt.toISOString(),
  };
}

function serializeSummary(record: InvoiceRecord): InvoiceSummary {
  const total = toNumber(record.total);
  const amountPaid = toNumber(record.amountPaid);
  const balanceDue = round2(total - amountPaid);
  return {
    id: record.id,
    number: record.number,
    status: record.status as InvoiceStatus,
    isOverdue: isOverdueStatus(record.status, record.dueDate, balanceDue),
    issueDate: record.issueDate.toISOString(),
    dueDate: record.dueDate.toISOString(),
    currency: record.currency,
    taxRate: toNumber(record.taxRate),
    discountType: record.discountType as DiscountType,
    discountValue: toNumber(record.discountValue),
    discountAmount: toNumber(record.discountAmount),
    subtotal: toNumber(record.subtotal),
    tax: toNumber(record.tax),
    total,
    amountPaid,
    balanceDue,
    notes: record.notes,
    terms: record.terms,
    sentAt: record.sentAt?.toISOString() ?? null,
    paidAt: record.paidAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    customer: record.customer,
    createdBy: record.createdBy,
    brandProfile: record.brandProfile,
    sourceQuote: record.sourceQuote,
    itemCount: record.items.length,
  };
}

function serializeDetail(record: InvoiceRecord): InvoiceDetail {
  return {
    ...serializeSummary(record),
    items: record.items.map(serializeItem),
    payments: record.payments.map(serializePayment),
  };
}

async function reserveInvoiceNumber(
  tx: Prisma.TransactionClient,
  year: number,
): Promise<string> {
  const next = await tx.invoiceSequence.upsert({
    where: { year },
    create: { year, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
  });
  return `INV-${year}-${String(next.lastNumber).padStart(4, '0')}`;
}

export async function listInvoices(): Promise<InvoiceSummary[]> {
  const records = await prisma.invoice.findMany({
    include: invoiceInclude,
    orderBy: [{ createdAt: 'desc' }],
  });
  return records.map(serializeSummary);
}

export async function getInvoice(id: number): Promise<InvoiceDetail | null> {
  const record = await prisma.invoice.findUnique({ where: { id }, include: invoiceInclude });
  return record ? serializeDetail(record) : null;
}

export interface InvoiceCreateInput {
  customerId: number;
  brandProfileId: number | null;
  sourceQuoteId?: number | null;
  issueDate: string;
  dueDate: string;
  currency: string;
  taxRate: number;
  discountType: DiscountType;
  discountValue: number;
  notes: string | null;
  terms: string | null;
  items: InvoiceItemDraft[];
  createdById: number;
}

export async function createInvoice(input: InvoiceCreateInput): Promise<InvoiceDetail> {
  const totals = computeQuoteTotals({
    items: input.items,
    taxRate: input.taxRate,
    discountType: input.discountType,
    discountValue: input.discountValue,
  });
  const year = new Date(input.issueDate).getUTCFullYear();

  return prisma.$transaction(async (tx) => {
    const number = await reserveInvoiceNumber(tx, year);
    const created = await tx.invoice.create({
      data: {
        number,
        customerId: input.customerId,
        createdById: input.createdById,
        brandProfileId: input.brandProfileId,
        sourceQuoteId: input.sourceQuoteId ?? null,
        status: 'Draft',
        issueDate: new Date(input.issueDate),
        dueDate: new Date(input.dueDate),
        currency: input.currency,
        taxRate: new Prisma.Decimal(input.taxRate),
        discountType: input.discountType,
        discountValue: new Prisma.Decimal(input.discountValue),
        discountAmount: totals.discountAmount,
        subtotal: totals.subtotal,
        tax: totals.tax,
        total: totals.total,
        notes: input.notes,
        terms: input.terms,
      },
    });

    if (totals.items.length > 0) {
      await tx.invoiceItem.createMany({
        data: totals.items.map((item) => ({
          invoiceId: created.id,
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

    const fresh = await tx.invoice.findUnique({ where: { id: created.id }, include: invoiceInclude });
    return serializeDetail(fresh!);
  });
}

export interface InvoiceUpdateInput {
  customerId?: number;
  brandProfileId?: number | null;
  issueDate?: string;
  dueDate?: string;
  currency?: string;
  taxRate?: number;
  discountType?: DiscountType;
  discountValue?: number;
  notes?: string | null;
  terms?: string | null;
  items?: InvoiceItemDraft[];
}

export async function updateInvoice(params: {
  id: number;
  input: InvoiceUpdateInput;
}): Promise<InvoiceDetail | { error: string }> {
  const existing = await prisma.invoice.findUnique({
    where: { id: params.id },
    include: invoiceInclude,
  });
  if (!existing) return { error: 'Invoice not found' };
  if (existing.status === 'Paid' || existing.status === 'Void') {
    return { error: `Cannot edit a ${existing.status.toLowerCase()} invoice` };
  }

  const taxRate = params.input.taxRate ?? toNumber(existing.taxRate);
  const discountType = (params.input.discountType ?? existing.discountType) as DiscountType;
  const discountValue = params.input.discountValue ?? toNumber(existing.discountValue);
  const items =
    params.input.items ??
    existing.items.map<InvoiceItemDraft>((item) => ({
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
    await tx.invoice.update({
      where: { id: params.id },
      data: {
        customerId: params.input.customerId ?? existing.customerId,
        brandProfileId:
          params.input.brandProfileId === undefined
            ? existing.brandProfileId
            : params.input.brandProfileId,
        issueDate:
          params.input.issueDate !== undefined ? new Date(params.input.issueDate) : existing.issueDate,
        dueDate: params.input.dueDate !== undefined ? new Date(params.input.dueDate) : existing.dueDate,
        currency: params.input.currency ?? existing.currency,
        taxRate: new Prisma.Decimal(taxRate),
        discountType,
        discountValue: new Prisma.Decimal(discountValue),
        discountAmount: totals.discountAmount,
        subtotal: totals.subtotal,
        tax: totals.tax,
        total: totals.total,
        notes: params.input.notes === undefined ? existing.notes : params.input.notes,
        terms: params.input.terms === undefined ? existing.terms : params.input.terms,
      },
    });

    if (params.input.items) {
      await tx.invoiceItem.deleteMany({ where: { invoiceId: params.id } });
      await tx.invoiceItem.createMany({
        data: totals.items.map((item) => ({
          invoiceId: params.id,
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

    const fresh = await tx.invoice.findUnique({ where: { id: params.id }, include: invoiceInclude });
    return serializeDetail(fresh!);
  });
}

export async function sendInvoice(id: number): Promise<InvoiceDetail | { error: string }> {
  const existing = await prisma.invoice.findUnique({ where: { id }, include: invoiceInclude });
  if (!existing) return { error: 'Invoice not found' };
  if (existing.status === 'Void') return { error: 'Cannot send a void invoice' };
  await prisma.invoice.update({
    where: { id },
    data: { status: existing.status === 'Draft' ? 'Sent' : existing.status, sentAt: existing.sentAt ?? new Date() },
  });
  const fresh = await prisma.invoice.findUnique({ where: { id }, include: invoiceInclude });
  return serializeDetail(fresh!);
}

export interface InvoicePaymentInput {
  amount: number;
  method: string;
  reference: string | null;
  note: string | null;
  paidAt: string;
}

export async function recordInvoicePayment(params: {
  invoiceId: number;
  userId: number;
  input: InvoicePaymentInput;
}): Promise<InvoiceDetail | { error: string }> {
  const existing = await prisma.invoice.findUnique({
    where: { id: params.invoiceId },
    include: invoiceInclude,
  });
  if (!existing) return { error: 'Invoice not found' };
  if (existing.status === 'Void') return { error: 'Cannot record a payment on a void invoice' };
  if (!(params.input.amount > 0)) return { error: 'Payment amount must be greater than zero' };

  const total = toNumber(existing.total);

  return prisma.$transaction(async (tx) => {
    await tx.invoicePayment.create({
      data: {
        invoiceId: params.invoiceId,
        amount: new Prisma.Decimal(params.input.amount),
        method: params.input.method,
        reference: params.input.reference,
        note: params.input.note,
        paidAt: new Date(params.input.paidAt),
        createdById: params.userId,
      },
    });

    const agg = await tx.invoicePayment.aggregate({
      where: { invoiceId: params.invoiceId },
      _sum: { amount: true },
    });
    const newPaid = round2(toNumber(agg._sum.amount ?? null));

    let status = existing.status;
    let paidAt = existing.paidAt;
    if (total > 0 && newPaid >= total) {
      status = 'Paid';
      paidAt = new Date();
    } else if (newPaid > 0) {
      status = 'Partial';
      paidAt = null;
    }

    await tx.invoice.update({
      where: { id: params.invoiceId },
      data: {
        amountPaid: new Prisma.Decimal(newPaid),
        status,
        paidAt,
        sentAt: existing.sentAt ?? new Date(),
      },
    });

    const fresh = await tx.invoice.findUnique({ where: { id: params.invoiceId }, include: invoiceInclude });
    return serializeDetail(fresh!);
  });
}

export async function voidInvoice(id: number): Promise<InvoiceDetail | { error: string }> {
  const existing = await prisma.invoice.findUnique({ where: { id }, include: invoiceInclude });
  if (!existing) return { error: 'Invoice not found' };
  await prisma.invoice.update({ where: { id }, data: { status: 'Void' } });
  const fresh = await prisma.invoice.findUnique({ where: { id }, include: invoiceInclude });
  return serializeDetail(fresh!);
}

export async function deleteInvoice(id: number): Promise<true | { error: string }> {
  const existing = await prisma.invoice.findUnique({ where: { id } });
  if (!existing) return { error: 'Invoice not found' };
  if (existing.status !== 'Draft') {
    return { error: 'Only draft invoices can be deleted. Void sent invoices instead.' };
  }
  await prisma.invoice.delete({ where: { id } });
  return true;
}

export async function createInvoiceFromQuote(params: {
  quoteId: number;
  userId: number;
  dueInDays?: number;
}): Promise<InvoiceDetail | { error: string }> {
  const quote = await prisma.quote.findUnique({
    where: { id: params.quoteId },
    include: { items: { orderBy: { position: 'asc' } } },
  });
  if (!quote) return { error: 'Quote not found' };

  const items: InvoiceItemDraft[] = quote.items.map((item) => ({
    description: item.description,
    quantity: toNumber(item.quantity),
    unitPrice: toNumber(item.unitPrice),
    taxable: item.taxable,
    discountType: item.discountType as DiscountType,
    discountValue: toNumber(item.discountValue),
    productId: item.productId,
  }));

  const now = new Date();
  const due = new Date(now.getTime() + (params.dueInDays ?? 14) * 24 * 3600 * 1000);

  return createInvoice({
    customerId: quote.customerId,
    brandProfileId: quote.brandProfileId,
    sourceQuoteId: quote.id,
    issueDate: now.toISOString(),
    dueDate: due.toISOString(),
    currency: quote.currency,
    taxRate: toNumber(quote.taxRate),
    discountType: quote.discountType as DiscountType,
    discountValue: toNumber(quote.discountValue),
    notes: quote.notes,
    terms: quote.terms,
    items,
    createdById: params.userId,
  });
}

export async function listInvoiceableQuotes(): Promise<
  Array<{ id: number; reference: string; subject: string; customer: string; total: number; currency: string }>
> {
  const quotes = await prisma.quote.findMany({
    where: { status: { in: ['Approved', 'Sent'] } },
    select: {
      id: true,
      reference: true,
      subject: true,
      total: true,
      currency: true,
      customer: { select: { name: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: 100,
  });
  return quotes.map((q) => ({
    id: q.id,
    reference: q.reference,
    subject: q.subject,
    customer: q.customer.name,
    total: toNumber(q.total),
    currency: q.currency,
  }));
}
