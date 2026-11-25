import 'server-only';

import type { ZodType } from 'zod';

import { EmailError, isEmailConfigured } from '@/lib/email';
import {
  createInvoice,
  createInvoiceFromQuote,
  decideInvoice,
  deleteInvoice,
  getInvoice,
  INVOICE_STATUSES,
  listInvoiceableQuotes,
  listInvoiceApproverCandidates,
  listInvoices,
  PAYMENT_METHODS,
  recordInvoicePayment,
  sendInvoice,
  submitInvoiceForApproval,
  updateInvoice,
  voidInvoice,
  type InvoiceDetail,
  type InvoiceItemDraft,
  type InvoiceSummary,
  type InvoiceUpdateInput,
} from '@/lib/invoices';
import { prisma } from '@/lib/prisma';
import type { QuickBooksSyncResult } from '@/lib/quickbooks';
import { getQuoteForUser, type QuoteItemDraft } from '@/lib/quotes';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { emailInvoiceApprovalRequest, emailInvoiceDecisionToCreator, emailInvoiceToCustomer } from '@/lib/transactional-email';
import { buildAccessUser, userAccessInclude, userHasModule, userHasRole } from '@/lib/user';
import {
  invoiceCreateSchema,
  invoiceDecisionSchema,
  invoiceFromQuoteSchema,
  invoicePaymentSchema,
  invoiceSubmitSchema,
  invoiceUpdateSchema,
} from '@/lib/validation';

import { asString, type JsonSchema, type ToolContext, type ToolDefinition, ToolRefusal } from '../types';
import {
  audit,
  changedFields,
  matches,
  optAmount,
  optCurrency,
  optDate,
  optEnum,
  optFlag,
  optId,
  optText,
  pageOf,
  parseWith,
  reqId,
  requireChange,
  todayIn,
} from './_shared';
import {
  addDays,
  clip,
  dateOf,
  type Discount,
  discountLabel,
  discountProperties,
  documentDefaults,
  invoiceLineProperties,
  type LineDocument,
  lineLabel,
  lineListSchema,
  lineTools,
  lineView,
  money,
  onlyGiven,
  readDiscount,
  readLines,
  readTaxRate,
  requireCustomer,
  requireProducts,
  settle,
  taxRateProperty,
  trimChanges,
} from './quotes';

/** The invoice routes all ask for this one module (or an admin). */
const MODULE = 'invoices-review';
const PAGE_SIZE = 20;

const invoiceHref = (id: number) => `/modules/invoices-review?open=${id}`;

/** The page's own line schema. It has no `days`: an invoice line has no such column. */
const INVOICE_LINE = invoiceCreateSchema.shape.items.element as ZodType<InvoiceItemDraft>;

/** Approved and out of the door, with money still owed. */
const isUnpaid = (invoice: InvoiceSummary) =>
  (invoice.status === 'Approved' || invoice.status === 'Sent' || invoice.status === 'Partial') && invoice.balanceDue > 0;

async function loadInvoice(id: number): Promise<InvoiceDetail> {
  const invoice = await getInvoice(id);
  if (!invoice) throw new ToolRefusal(`Invoice ${id} was not found. Find it with list_invoices.`);
  return invoice;
}

/**
 * The invoice with each line's own discount. The lib's line summary leaves the
 * discount out, and a line written back without it would lose it.
 */
async function invoiceDocument(invoice: InvoiceDetail): Promise<LineDocument> {
  const rows = await prisma.invoiceItem.findMany({
    where: { invoiceId: invoice.id },
    select: { id: true, discountType: true, discountValue: true },
  });
  const discounts = new Map(rows.map((row) => [row.id, row]));
  return {
    id: invoice.id,
    name: invoice.number,
    status: invoice.status,
    currency: invoice.currency,
    total: invoice.total,
    lines: invoice.items.map((item) => {
      const discount = discounts.get(item.id);
      return {
        id: item.id,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        taxable: item.taxable,
        discountType: (discount?.discountType ?? 'none') as Discount,
        discountValue: discount ? Number(String(discount.discountValue)) : 0,
        productId: item.productId,
        total: item.total,
      };
    }),
  };
}

const numberProperty: JsonSchema = { type: 'string', description: 'The invoice number, shown to the user when they confirm' };
const named = (args: Record<string, unknown>) => asString(args.number) ?? `#${args.invoiceId}`;

/** What the user was shown on the Confirm card has to be the record the call acts on. */
function requireNamed(args: Record<string, unknown>, invoice: InvoiceDetail): void {
  const number = asString(args.number);
  if (number && number.toLowerCase() !== invoice.number.toLowerCase()) {
    throw new ToolRefusal(`Invoice ${invoice.id} is ${invoice.number}, not ${number}. Nothing was done: check which invoice is meant.`);
  }
}

// --- Finding and reading -------------------------------------------------------------

const listInvoicesTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'list_invoices',
    description:
      'Find invoices, newest first (overdue ones: longest overdue first). Search by number or client; filter by status, client, overdue or unpaid. Also returns what is owed across the matches, by currency. 20 per page.',
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Invoice number (INV-2026-0012), client, or source quote reference' },
        status: { type: 'string', enum: [...INVOICE_STATUSES] },
        overdue: { type: 'boolean', description: 'Sent, past the due date and not fully paid' },
        unpaid: { type: 'boolean', description: 'Approved or sent with a balance still due' },
        customerId: { type: 'integer' },
        page: { type: 'integer' },
      },
    },
  },
  async handler(args, ctx) {
    const q = asString(args.q);
    const status = optEnum(args, 'status', INVOICE_STATUSES);
    const overdue = optFlag(args, 'overdue') === true;
    const unpaid = optFlag(args, 'unpaid') === true;
    const customerId = optId(args, 'customerId');
    const rows = (await listInvoices()).filter(
      (invoice) =>
        (!status || invoice.status === status) &&
        (!overdue || invoice.isOverdue) &&
        (!unpaid || isUnpaid(invoice)) &&
        (!customerId || invoice.customer.id === customerId) &&
        matches(q, invoice.number, invoice.customer.name, invoice.customer.company, invoice.sourceQuote?.reference),
    );
    if (overdue) rows.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const owed: Record<string, number> = {};
    for (const invoice of rows) {
      if (isUnpaid(invoice)) owed[invoice.currency] = Math.round(((owed[invoice.currency] ?? 0) + invoice.balanceDue) * 100) / 100;
    }
    const page = pageOf(rows, args, PAGE_SIZE);
    return {
      total: page.total,
      page: page.page,
      more: page.more,
      balanceDue: owed,
      invoices: page.rows.map((invoice) => ({
        id: invoice.id,
        number: invoice.number,
        status: invoice.status,
        ...(invoice.isOverdue ? { overdue: true } : {}),
        client: invoice.customer.name,
        total: invoice.total,
        balanceDue: invoice.balanceDue,
        currency: invoice.currency,
        issueDate: dateOf(invoice.issueDate, ctx.timeZone),
        dueDate: dateOf(invoice.dueDate, ctx.timeZone),
        ...(invoice.sourceQuote ? { quote: invoice.sourceQuote.reference } : {}),
        href: invoiceHref(invoice.id),
      })),
    };
  },
};

const getInvoiceTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'get_invoice',
    description: 'Open one invoice: client, dates, totals, balance, approval, every line with its id and position, and the payments recorded.',
    parameters: { type: 'object', properties: { invoiceId: { type: 'integer' } }, required: ['invoiceId'] },
  },
  async handler(args, ctx) {
    const invoice = await loadInvoice(reqId(args, 'invoiceId', 'use list_invoices'));
    const document = await invoiceDocument(invoice);
    return {
      id: invoice.id,
      number: invoice.number,
      status: invoice.status,
      overdue: invoice.isOverdue,
      client: { id: invoice.customer.id, name: invoice.customer.name, email: invoice.customer.email },
      issueDate: dateOf(invoice.issueDate, ctx.timeZone),
      dueDate: dateOf(invoice.dueDate, ctx.timeZone),
      currency: invoice.currency,
      taxRate: invoice.taxRate,
      subtotal: invoice.subtotal,
      tax: invoice.tax,
      ...(invoice.discountType !== 'none'
        ? { discount: discountLabel(invoice.discountType, invoice.discountValue), discountAmount: invoice.discountAmount }
        : {}),
      total: invoice.total,
      amountPaid: invoice.amountPaid,
      balanceDue: invoice.balanceDue,
      approver: invoice.approver ? { id: invoice.approver.id, name: invoice.approver.name } : null,
      createdBy: invoice.createdBy.name,
      company: invoice.brandProfile?.name ?? null,
      ...(invoice.sourceQuote ? { quote: invoice.sourceQuote.reference } : {}),
      ...(invoice.decisionNote ? { decisionNote: invoice.decisionNote } : {}),
      sent: dateOf(invoice.sentAt, ctx.timeZone),
      notes: clip(invoice.notes, 600),
      terms: clip(invoice.terms, 600),
      lines: document.lines.map(lineView),
      payments: invoice.payments.map((payment) => ({
        amount: payment.amount,
        method: payment.method,
        paidAt: dateOf(payment.paidAt, ctx.timeZone),
        ...(payment.reference ? { reference: payment.reference } : {}),
        ...(payment.note ? { note: payment.note } : {}),
        recordedBy: payment.recordedBy?.name ?? null,
      })),
      href: invoiceHref(invoice.id),
    };
  },
};

// --- Creating and editing ------------------------------------------------------------

const createInvoiceTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'create_invoice',
    description:
      "Create a draft invoice for a client. Left out: issue date is today, due 14 days after, currency and tax rate are the company's defaults. To bill an approved quote use create_invoice_from_quote.",
    parameters: {
      type: 'object',
      properties: {
        customerId: { type: 'integer' },
        items: lineListSchema(invoiceLineProperties, 'The lines, at least one. No days: put the total units in quantity'),
        issueDate: { type: 'string', description: 'YYYY-MM-DD' },
        dueDate: { type: 'string', description: 'YYYY-MM-DD' },
        currency: { type: 'string', description: '3-letter code' },
        taxRate: taxRateProperty,
        ...discountProperties,
        notes: { type: 'string' },
        terms: { type: 'string' },
      },
      required: ['customerId', 'items'],
    },
  },
  async handler(args, ctx) {
    const customerId = reqId(args, 'customerId', 'find the client with list_customers');
    const items = readLines(INVOICE_LINE, args.items, 'invoice');
    const issueDate = optDate(args, 'issueDate') ?? todayIn(ctx.timeZone);
    const dueDate = optDate(args, 'dueDate') ?? addDays(issueDate, 14);
    if (dueDate < issueDate) throw new ToolRefusal(`dueDate (${dueDate}) is before issueDate (${issueDate}).`);
    const currency = optCurrency(args);
    const taxRate = readTaxRate(args);
    const discount = readDiscount(args, { discountType: 'none', discountValue: 0 }) ?? { discountType: 'none' as const, discountValue: 0 };
    const notes = optText(args, 'notes', { max: 2000 }) ?? null;
    const terms = optText(args, 'terms', { max: 5000 }) ?? null;

    await requireCustomer(customerId);
    await requireProducts(items);
    const defaults = await documentDefaults();

    const data = parseWith(invoiceCreateSchema, {
      customerId,
      brandProfileId: defaults.brandProfileId,
      issueDate,
      dueDate,
      currency: currency ?? defaults.currency,
      taxRate: taxRate ?? defaults.taxRate,
      ...discount,
      notes,
      terms,
      items,
    });
    const invoice = await createInvoice({
      customerId: data.customerId,
      brandProfileId: data.brandProfileId ?? null,
      sourceQuoteId: null,
      issueDate: data.issueDate,
      dueDate: data.dueDate,
      currency: data.currency,
      taxRate: data.taxRate,
      discountType: data.discountType,
      discountValue: data.discountValue,
      notes: data.notes ?? null,
      terms: data.terms ?? null,
      items: data.items,
      createdById: ctx.userId,
    });
    await audit({
      action: 'invoice.created',
      entityType: 'invoice',
      entityId: String(invoice.id),
      actorUserId: ctx.userId,
      metadata: { number: invoice.number, customerId: invoice.customer.id, via: 'assistant' },
      request: ctx.request,
    });
    return {
      id: invoice.id,
      number: invoice.number,
      status: invoice.status,
      client: invoice.customer.name,
      issueDate: dateOf(invoice.issueDate, ctx.timeZone),
      dueDate: dateOf(invoice.dueDate, ctx.timeZone),
      currency: invoice.currency,
      taxRate: invoice.taxRate,
      total: invoice.total,
      lines: invoice.items.length,
      href: invoiceHref(invoice.id),
      summary: `Created invoice ${invoice.number} for ${invoice.customer.name}: ${money(invoice.total, invoice.currency)}`,
    };
  },
};

const invoiceFacts = (invoice: InvoiceDetail, timeZone: string, lines: string[]): Record<string, unknown> => ({
  status: invoice.status,
  issueDate: dateOf(invoice.issueDate, timeZone),
  dueDate: dateOf(invoice.dueDate, timeZone),
  currency: invoice.currency,
  taxRate: invoice.taxRate,
  discount: invoice.discountType === 'none' ? null : discountLabel(invoice.discountType, invoice.discountValue),
  notes: invoice.notes,
  terms: invoice.terms,
  lines,
  total: invoice.total,
});

const INVOICE_FIELDS = Object.keys({
  status: 1, issueDate: 1, dueDate: 1, currency: 1, taxRate: 1, discount: 1, notes: 1, terms: 1, lines: 1, total: 1,
});

const updateInvoiceTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'update_invoice',
    description:
      'Change a draft or declined invoice: dates, currency, tax rate, discount, notes, terms. Send only what should change. `items` REPLACES every line: to add, change or remove one line use the line tools.',
    parameters: {
      type: 'object',
      properties: {
        invoiceId: { type: 'integer' },
        issueDate: { type: 'string', description: 'YYYY-MM-DD' },
        dueDate: { type: 'string', description: 'YYYY-MM-DD' },
        currency: { type: 'string', description: '3-letter code' },
        taxRate: taxRateProperty,
        ...discountProperties,
        notes: { type: 'string', description: 'null clears', nullable: true },
        terms: { type: 'string', description: 'null clears', nullable: true },
        items: lineListSchema(invoiceLineProperties, 'Replaces ALL lines; at least one. No days'),
      },
      required: ['invoiceId'],
    },
  },
  async handler(args, ctx) {
    const id = reqId(args, 'invoiceId', 'use list_invoices');
    const before = await loadInvoice(id);

    const input: Record<string, unknown> = {};
    for (const key of ['issueDate', 'dueDate'] as const) {
      const value = optDate(args, key);
      if (value) input[key] = value;
    }
    const currency = optCurrency(args);
    if (currency) input.currency = currency;
    const taxRate = readTaxRate(args);
    if (taxRate !== undefined) input.taxRate = taxRate;
    const discount = readDiscount(args, before);
    if (discount) Object.assign(input, discount);
    for (const [key, max] of [['notes', 2000], ['terms', 5000]] as const) {
      const value = optText(args, key, { max });
      if (value !== undefined) input[key] = value;
    }
    if (args.items !== undefined) input.items = readLines(INVOICE_LINE, args.items, 'invoice');

    if (Object.keys(input).length === 0) throw new ToolRefusal('Say what to change on the invoice.');
    const issue = (input.issueDate as string | undefined) ?? dateOf(before.issueDate, ctx.timeZone)!;
    const due = (input.dueDate as string | undefined) ?? dateOf(before.dueDate, ctx.timeZone)!;
    if (due < issue) throw new ToolRefusal(`The due date (${due}) would be before the issue date (${issue}).`);
    if (input.items) await requireProducts(input.items as InvoiceItemDraft[]);

    // The lines are only compared when they were sent: reading them costs a query each way.
    const linesBefore = input.items ? (await invoiceDocument(before)).lines.map(lineLabel) : [];
    const data = onlyGiven(parseWith(invoiceUpdateSchema, input), input) as InvoiceUpdateInput;
    const after = settle(await updateInvoice({ id, input: data }));
    const linesAfter = input.items ? (await invoiceDocument(after)).lines.map(lineLabel) : [];

    const changed = changedFields(invoiceFacts(before, ctx.timeZone, linesBefore), invoiceFacts(after, ctx.timeZone, linesAfter), INVOICE_FIELDS);
    requireChange(changed, `invoice ${before.number}`);
    trimChanges(changed);
    await audit({
      action: 'invoice.updated',
      entityType: 'invoice',
      entityId: String(id),
      actorUserId: ctx.userId,
      metadata: { number: after.number, fields: Object.keys(changed), via: 'assistant' },
      request: ctx.request,
    });
    return {
      id,
      number: after.number,
      status: after.status,
      total: after.total,
      currency: after.currency,
      changed,
      href: invoiceHref(id),
      summary: `Updated invoice ${after.number}: ${Object.keys(changed).join(', ')}`,
    };
  },
};

const invoiceLineTools = lineTools({
  kind: 'invoice',
  idKey: 'invoiceId',
  nameKey: 'number',
  requiredModule: MODULE,
  properties: invoiceLineProperties,
  // The same shape as a quote line less `days`, which this schema does not let through.
  schema: INVOICE_LINE as ZodType<QuoteItemDraft>,
  href: invoiceHref,
  load: async (id) => invoiceDocument(await loadInvoice(id)),
  async save(doc, lines, ctx, change) {
    const after = settle(await updateInvoice({ id: doc.id, input: { items: lines } }));
    await audit({
      action: 'invoice.updated',
      entityType: 'invoice',
      entityId: String(doc.id),
      actorUserId: ctx.userId,
      metadata: { number: after.number, line: change, via: 'assistant' },
      request: ctx.request,
    });
    return invoiceDocument(after);
  },
});

// --- Approval ------------------------------------------------------------------------

const listApproversTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'list_invoice_approvers',
    description: 'People who can approve an invoice: active users other than this one who hold Invoices or are admins. Returns the approverId.',
    parameters: { type: 'object', properties: { q: { type: 'string', description: 'Name or email' } } },
  },
  async handler(args, ctx) {
    const q = asString(args.q);
    const candidates = await listInvoiceApproverCandidates(ctx.userId);
    // The page offers every active user, but only someone who can open Invoices can decide one.
    const access = await prisma.user.findMany({ where: { id: { in: candidates.map((user) => user.id) } }, include: userAccessInclude });
    const able = new Set(
      access
        .map(buildAccessUser)
        .filter((user) => userHasRole(user, ADMIN_ROLE_NAME) || userHasModule(user, MODULE))
        .map((user) => user.id),
    );
    const rows = candidates.filter((user) => able.has(user.id) && matches(q, user.name, user.email));
    return { total: rows.length, approvers: rows.slice(0, 40).map((user) => ({ approverId: user.id, name: user.name, email: user.email })) };
  },
};

const reviewUrl = (ctx: ToolContext) => new URL('/modules/invoices-review', ctx.request.nextUrl.origin).toString();

const submitInvoiceTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'submit_invoice_for_approval',
    description:
      'Submit a draft or declined invoice to an approver (list_invoice_approvers), who gets a notification and an email. Nobody can approve their own invoice.',
    parameters: {
      type: 'object',
      properties: { invoiceId: { type: 'integer' }, approverId: { type: 'integer' } },
      required: ['invoiceId', 'approverId'],
    },
  },
  async handler(args, ctx) {
    const id = reqId(args, 'invoiceId', 'use list_invoices');
    const { approverId } = parseWith(invoiceSubmitSchema, { approverId: reqId(args, 'approverId', 'use list_invoice_approvers') });
    const result = settle(await submitInvoiceForApproval({ id, userId: ctx.userId, isAdmin: ctx.isAdmin, approverId }));

    // Best effort, as on the page: the approver already has the notification.
    let approverEmailed = false;
    if (isEmailConfigured() && result.approver?.email) {
      try {
        await emailInvoiceApprovalRequest({
          invoice: result,
          approver: { name: result.approver.name, email: result.approver.email },
          submitterName: ctx.userName,
          reviewUrl: reviewUrl(ctx),
        });
        approverEmailed = true;
      } catch (error) {
        console.error('[assistant] approval request email failed:', error);
      }
    }
    await audit({
      action: 'invoice.submitted',
      entityType: 'invoice',
      entityId: String(id),
      actorUserId: ctx.userId,
      metadata: { number: result.number, approverId, approverEmailed, via: 'assistant' },
      request: ctx.request,
    });
    return {
      id,
      number: result.number,
      status: result.status,
      approver: result.approver?.name ?? null,
      approverEmailed,
      href: invoiceHref(id),
      summary: `Submitted invoice ${result.number} to ${result.approver?.name ?? 'the approver'} for approval`,
    };
  },
};

const decideInvoiceTool: ToolDefinition = {
  destructive: true,
  requiredModule: MODULE,
  confirmLabel: (args) => `${args.decision === 'declined' ? 'Decline' : 'Approve'} invoice ${named(args)}`,
  functionDeclaration: {
    name: 'decide_invoice',
    description:
      'Approve or decline an invoice that is Pending Approval, as its approver (or an admin). Never the person who created it. The creator is told.',
    parameters: {
      type: 'object',
      properties: {
        invoiceId: { type: 'integer' },
        decision: { type: 'string', enum: ['approved', 'declined'] },
        note: { type: 'string', description: 'Reason, shown to the creator' },
        number: numberProperty,
      },
      required: ['invoiceId', 'decision'],
    },
  },
  async handler(args, ctx) {
    const id = reqId(args, 'invoiceId', 'use list_invoices');
    const { decision, note } = parseWith(invoiceDecisionSchema, {
      decision: optEnum(args, 'decision', ['approved', 'declined'] as const),
      note: optText(args, 'note', { max: 1000 }) ?? null,
    });
    requireNamed(args, await loadInvoice(id));
    const result = settle(await decideInvoice({ id, userId: ctx.userId, isAdmin: ctx.isAdmin, decision, note: note ?? null }));

    if (isEmailConfigured() && result.createdBy.email) {
      try {
        await emailInvoiceDecisionToCreator({ invoice: result, decision, note: note ?? null, reviewUrl: reviewUrl(ctx) });
      } catch (error) {
        console.error('[assistant] decision email failed:', error);
      }
    }
    await audit({
      action: `invoice.${decision}`,
      entityType: 'invoice',
      entityId: String(id),
      actorUserId: ctx.userId,
      metadata: { number: result.number, via: 'assistant' },
      request: ctx.request,
    });
    return {
      id,
      number: result.number,
      status: result.status,
      href: invoiceHref(id),
      summary: `${decision === 'approved' ? 'Approved' : 'Declined'} invoice ${result.number}`,
    };
  },
};

// --- Money and dispatch --------------------------------------------------------------

function quickbooksOutcome(sync: QuickBooksSyncResult | undefined) {
  if (!sync) return undefined;
  if (sync.status === 'synced') return { status: 'synced', quickbooksPaymentId: sync.quickbooksPaymentId };
  if (sync.status === 'failed') return { status: 'failed', error: sync.error };
  return { status: 'not sent', reason: sync.reason === 'not_configured' ? 'QuickBooks is not set up' : 'QuickBooks is not connected' };
}

const recordPaymentTool: ToolDefinition = {
  destructive: true,
  requiredModule: MODULE,
  confirmLabel: (args) =>
    `Record a payment of ${asString(args.currency)?.toUpperCase() ?? ''} ${asString(args.amount) ?? '?'} on invoice ${named(args)}${
      asString(args.paidAt) ? `, dated ${asString(args.paidAt)}` : ''
    } (cannot be undone here)`.replace(/\s+/g, ' '),
  functionDeclaration: {
    name: 'record_invoice_payment',
    description:
      'Record money received against an approved or sent invoice. It moves the invoice to Partial or Paid, is pushed to QuickBooks, and cannot be undone here.',
    parameters: {
      type: 'object',
      properties: {
        invoiceId: { type: 'integer' },
        amount: { type: 'number', description: "More than 0, in the invoice's currency" },
        paidAt: { type: 'string', description: 'YYYY-MM-DD the money was received; default today' },
        method: { type: 'string', enum: [...PAYMENT_METHODS], description: 'Default Bank transfer' },
        reference: { type: 'string', description: 'Bank or M-Pesa reference' },
        note: { type: 'string' },
        number: numberProperty,
        currency: { type: 'string', description: "The invoice's currency, shown to the user when they confirm" },
      },
      required: ['invoiceId', 'amount'],
    },
  },
  async handler(args, ctx) {
    const invoiceId = reqId(args, 'invoiceId', 'use list_invoices');
    const amount = optAmount(args, 'amount', { min: 0, max: 100_000_000 });
    if (amount === undefined || amount <= 0) throw new ToolRefusal('amount must be more than zero. Nothing was recorded.');
    const input = parseWith(invoicePaymentSchema, {
      amount,
      method: optEnum(args, 'method', PAYMENT_METHODS) ?? 'Bank transfer',
      reference: optText(args, 'reference', { max: 100 }) ?? null,
      note: optText(args, 'note', { max: 1000 }) ?? null,
      paidAt: optDate(args, 'paidAt') ?? todayIn(ctx.timeZone),
    });
    const currency = optCurrency(args);

    const before = await loadInvoice(invoiceId);
    requireNamed(args, before);
    if (currency && currency !== before.currency) {
      throw new ToolRefusal(`Invoice ${before.number} is in ${before.currency}, not ${currency}. Nothing was recorded.`);
    }

    const result = settle(
      await recordInvoicePayment({
        invoiceId,
        userId: ctx.userId,
        input: { amount: input.amount, method: input.method, reference: input.reference ?? null, note: input.note ?? null, paidAt: input.paidAt },
      }),
    );
    await audit({
      action: 'invoice.payment.recorded',
      entityType: 'invoice',
      entityId: String(invoiceId),
      actorUserId: ctx.userId,
      metadata: { number: result.number, amount: input.amount, paidAt: input.paidAt, via: 'assistant' },
      request: ctx.request,
    });
    const quickbooks = quickbooksOutcome(result.quickbooks);
    return {
      id: invoiceId,
      number: result.number,
      status: result.status,
      payment: { amount: input.amount, method: input.method, paidAt: input.paidAt, reference: input.reference ?? null },
      amountPaid: result.amountPaid,
      balanceDue: result.balanceDue,
      currency: result.currency,
      ...(quickbooks ? { quickbooks } : {}),
      ...(input.amount > before.balanceDue
        ? { note: `This is more than the ${money(before.balanceDue, before.currency)} that was due.` }
        : {}),
      href: invoiceHref(invoiceId),
      summary: `Recorded ${money(input.amount, result.currency)} on invoice ${result.number} (${input.paidAt}): now ${result.status}, ${money(result.balanceDue, result.currency)} due`,
    };
  },
};

const sendInvoiceTool: ToolDefinition = {
  destructive: true,
  requiredModule: MODULE,
  confirmLabel: (args) => `Email invoice ${named(args)} to the client and mark it Sent`,
  functionDeclaration: {
    name: 'send_invoice',
    description:
      'Email an approved invoice to its client as a PDF and mark it Sent. Refused for a void or unapproved invoice, when email is not set up, or when the client has no address.',
    parameters: { type: 'object', properties: { invoiceId: { type: 'integer' }, number: numberProperty }, required: ['invoiceId'] },
  },
  async handler(args, ctx) {
    const id = reqId(args, 'invoiceId', 'use list_invoices');
    const invoice = await loadInvoice(id);
    requireNamed(args, invoice);
    // Every guard the invoice page has, in its order, before anything goes out.
    if (invoice.status === 'Void') throw new ToolRefusal(`Invoice ${invoice.number} is void and cannot be sent. Nothing was sent.`);
    if (invoice.status === 'Draft' || invoice.status === 'Pending Approval' || invoice.status === 'Declined') {
      throw new ToolRefusal(`Invoice ${invoice.number} is ${invoice.status}: it must be approved before it can be sent. Nothing was sent.`);
    }
    if (!isEmailConfigured()) throw new ToolRefusal('Email is not set up yet. An admin configures SMTP under Admin → Email. Nothing was sent.');
    if (!invoice.customer.email) {
      throw new ToolRefusal(`${invoice.customer.name} has no email address on file. Add one before sending. Nothing was sent.`);
    }

    // Deliver first; the invoice is only marked Sent once the email has gone.
    let emailedTo: string;
    try {
      emailedTo = (await emailInvoiceToCustomer(invoice)).to;
    } catch (error) {
      throw new ToolRefusal(
        `${error instanceof EmailError ? error.message : 'Could not send the invoice email.'} The invoice was not marked Sent.`,
      );
    }

    const sent = await sendInvoice(id);
    if ('error' in sent) throw new ToolRefusal(`The email went to ${emailedTo}, but the invoice could not be marked Sent: ${sent.error}`);
    await audit({
      action: 'invoice.sent',
      entityType: 'invoice',
      entityId: String(id),
      actorUserId: ctx.userId,
      metadata: { number: sent.number, emailedTo, via: 'assistant' },
      request: ctx.request,
    });
    return {
      id,
      number: sent.number,
      status: sent.status,
      emailedTo,
      href: invoiceHref(id),
      summary:
        invoice.status === 'Approved'
          ? `Emailed invoice ${sent.number} to ${emailedTo} and marked it Sent`
          : `Emailed invoice ${sent.number} to ${emailedTo} again (it stays ${sent.status})`,
    };
  },
};

// --- From a quote --------------------------------------------------------------------

/** The invoice already raised from a quote, if there is one that still counts. */
const invoiceOfQuote = (quoteId: number) =>
  prisma.invoice.findFirst({
    where: { sourceQuoteId: quoteId, status: { not: 'Void' } },
    select: { id: true, number: true, status: true },
  });

const listInvoiceableQuotesTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'list_invoiceable_quotes',
    description: 'Approved and sent quotes that can be turned into an invoice, most recently changed first, with the invoice already raised from each, if any.',
    parameters: { type: 'object', properties: { q: { type: 'string', description: 'Reference, subject or client' }, page: { type: 'integer' } } },
  },
  async handler(args) {
    const q = asString(args.q);
    const rows = (await listInvoiceableQuotes()).filter((quote) => matches(q, quote.reference, quote.subject, quote.customer));
    const page = pageOf(rows, args, PAGE_SIZE);
    const raised = page.rows.length
      ? await prisma.invoice.findMany({
          where: { sourceQuoteId: { in: page.rows.map((quote) => quote.id) }, status: { not: 'Void' } },
          select: { sourceQuoteId: true, number: true },
        })
      : [];
    const invoiced = new Map(raised.map((invoice) => [invoice.sourceQuoteId, invoice.number]));
    return {
      total: page.total,
      page: page.page,
      more: page.more,
      quotes: page.rows.map((quote) => ({
        quoteId: quote.id,
        reference: quote.reference,
        subject: quote.subject,
        client: quote.customer,
        total: quote.total,
        currency: quote.currency,
        ...(invoiced.has(quote.id) ? { invoicedAs: invoiced.get(quote.id) } : {}),
      })),
    };
  },
};

const invoiceFromQuoteTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'create_invoice_from_quote',
    description:
      'Raise a draft invoice from an Approved or Sent quote (list_invoiceable_quotes), copying its client, lines and totals. Refused for a quote that already has an invoice.',
    parameters: {
      type: 'object',
      properties: {
        quoteId: { type: 'integer' },
        dueInDays: { type: 'integer', description: 'Days from today until it is due, 0 to 365 (default 14)' },
      },
      required: ['quoteId'],
    },
  },
  async handler(args, ctx) {
    const { quoteId, dueInDays } = parseWith(invoiceFromQuoteSchema, {
      quoteId: reqId(args, 'quoteId', 'use list_invoiceable_quotes'),
      dueInDays: optAmount(args, 'dueInDays', { min: 0, max: 365, integer: true }),
    });

    // The quotes the invoice page offers; one it doesn't list is read as this user to say why not.
    const offered = (await listInvoiceableQuotes()).find((quote) => quote.id === quoteId);
    let reference = offered?.reference;
    if (!offered) {
      const quote = await getQuoteForUser({ id: quoteId, userId: ctx.userId, isAdmin: ctx.isAdmin });
      if (!quote) {
        throw new ToolRefusal(`Quote ${quoteId} is not one that can be invoiced: it was not found among the approved and sent quotes. See list_invoiceable_quotes.`);
      }
      if (quote.status !== 'Approved' && quote.status !== 'Sent') {
        throw new ToolRefusal(`Quote ${quote.reference} is ${quote.status}. Only an Approved or Sent quote can be invoiced. No invoice was created.`);
      }
      reference = quote.reference;
    }
    const existing = await invoiceOfQuote(quoteId);
    if (existing) {
      throw new ToolRefusal(
        `Quote ${reference} was already invoiced as ${existing.number} (${existing.status}). No second invoice was created; void that one first if it is to be replaced.`,
      );
    }

    const invoice = settle(await createInvoiceFromQuote({ quoteId, userId: ctx.userId, dueInDays }));
    await audit({
      action: 'invoice.created',
      entityType: 'invoice',
      entityId: String(invoice.id),
      actorUserId: ctx.userId,
      metadata: { number: invoice.number, fromQuoteId: quoteId, via: 'assistant' },
      request: ctx.request,
    });
    return {
      id: invoice.id,
      number: invoice.number,
      status: invoice.status,
      quote: reference,
      client: invoice.customer.name,
      dueDate: dateOf(invoice.dueDate, ctx.timeZone),
      total: invoice.total,
      currency: invoice.currency,
      href: invoiceHref(invoice.id),
      summary: `Created invoice ${invoice.number} from quote ${reference}: ${money(invoice.total, invoice.currency)}`,
    };
  },
};

// --- Voiding and deleting ------------------------------------------------------------

const voidInvoiceTool: ToolDefinition = {
  destructive: true,
  requiredModule: MODULE,
  confirmLabel: (args) => `Void invoice ${named(args)}: it stops counting towards what is owed, and cannot be un-voided`,
  functionDeclaration: {
    name: 'void_invoice',
    description: 'Void an invoice so it no longer counts towards what is owed. Not for a paid invoice. Cannot be undone.',
    parameters: { type: 'object', properties: { invoiceId: { type: 'integer' }, number: numberProperty }, required: ['invoiceId'] },
  },
  async handler(args, ctx) {
    const id = reqId(args, 'invoiceId', 'use list_invoices');
    const invoice = await loadInvoice(id);
    requireNamed(args, invoice);
    if (invoice.status === 'Void') throw new ToolRefusal(`Invoice ${invoice.number} is already void.`);
    if (invoice.status === 'Paid') throw new ToolRefusal(`Invoice ${invoice.number} is paid in full; a paid invoice cannot be voided.`);
    const result = settle(await voidInvoice(id));
    await audit({
      action: 'invoice.voided',
      entityType: 'invoice',
      entityId: String(id),
      actorUserId: ctx.userId,
      metadata: { number: result.number, via: 'assistant' },
      request: ctx.request,
    });
    return {
      id,
      number: result.number,
      status: result.status,
      ...(invoice.amountPaid > 0
        ? { note: `${money(invoice.amountPaid, invoice.currency)} had been recorded against it; those payments stay on the record.` }
        : {}),
      href: invoiceHref(id),
      summary: `Voided invoice ${result.number} (it was ${invoice.status})`,
    };
  },
};

const deleteInvoiceTool: ToolDefinition = {
  destructive: true,
  requiredModule: MODULE,
  confirmLabel: (args) => `Delete draft invoice ${named(args)} and its lines for good`,
  functionDeclaration: {
    name: 'delete_invoice',
    description: 'Delete a draft invoice. Anything past draft is voided instead (void_invoice). Cannot be undone.',
    parameters: { type: 'object', properties: { invoiceId: { type: 'integer' }, number: numberProperty }, required: ['invoiceId'] },
  },
  async handler(args, ctx) {
    const id = reqId(args, 'invoiceId', 'use list_invoices');
    const invoice = await loadInvoice(id);
    requireNamed(args, invoice);
    const result = await deleteInvoice(id);
    if (result !== true) throw new ToolRefusal(result.error);
    await audit({
      action: 'invoice.deleted',
      entityType: 'invoice',
      entityId: String(id),
      actorUserId: ctx.userId,
      metadata: { number: invoice.number, via: 'assistant' },
      request: ctx.request,
    });
    return { deleted: true, invoiceId: id, number: invoice.number, summary: `Deleted draft invoice ${invoice.number}` };
  },
};

export const invoiceTools: ToolDefinition[] = [
  listInvoicesTool,
  getInvoiceTool,
  createInvoiceTool,
  updateInvoiceTool,
  ...invoiceLineTools,
  listApproversTool,
  submitInvoiceTool,
  decideInvoiceTool,
  recordPaymentTool,
  sendInvoiceTool,
  listInvoiceableQuotesTool,
  invoiceFromQuoteTool,
  voidInvoiceTool,
  deleteInvoiceTool,
];
