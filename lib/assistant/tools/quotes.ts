import 'server-only';

import type { ZodType } from 'zod';

import { API_ACCESS } from '@/lib/api-access';
import { listBrandProfiles } from '@/lib/brand-profiles';
import { getCustomerById } from '@/lib/customers';
import { EmailError, isEmailConfigured } from '@/lib/email';
import { getOrganizationSettings } from '@/lib/organization';
import { getProductById } from '@/lib/products';
import {
  createQuote,
  decideQuote,
  deleteQuote,
  duplicateQuote,
  getQuoteForUser,
  listApproverCandidates,
  listQuotesForUser,
  markQuoteSent,
  QUOTE_STATUSES,
  submitQuote,
  updateDraftQuote,
  type QuoteDetail,
  type QuoteItemDraft,
  type QuoteUpdateInput,
} from '@/lib/quotes';
import { emailQuoteToCustomer } from '@/lib/transactional-email';
import { quoteCreateSchema, quoteDecisionSchema, quoteUpdateSchema } from '@/lib/validation';
import { utcToZoned } from '@/lib/zoned-time';

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
  reqText,
  requireChange,
  todayIn,
  unwrap,
} from './_shared';

const MODULE = API_ACCESS.quotes;
const PAGE_SIZE = 20;

const quoteHref = (id: number) => `/modules/quotes/${id}/edit`;

// --- Shared with the invoice tools ---------------------------------------------------

export const DISCOUNT_TYPES = ['none', 'percentage', 'fixed'] as const;
export type Discount = (typeof DISCOUNT_TYPES)[number];

/**
 * A lib's `{ error }` result as a refusal, like `unwrap`, with the error taken
 * out of the type that comes back (these libs return a bare `{ error }`, which
 * `unwrap` alone cannot tell from the record).
 */
export function settle<T>(result: T): Exclude<T, { error: string }> {
  return unwrap(result as T | { error: string }) as Exclude<T, { error: string }>;
}

export const clip = (text: string | null, max: number) => (text && text.length > max ? `${text.slice(0, max)}…` : text);

export const money = (amount: number, currency: string) =>
  `${currency} ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * A document date as the calendar day it means. One typed in is stored at
 * midnight UTC and is that day everywhere; one stamped by the server (a copy,
 * an invoice raised from a quote) is an instant, read on the user's wall.
 */
export function dateOf(iso: string | null | undefined, timeZone: string): string | null {
  if (!iso) return null;
  return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : utcToZoned(iso, timeZone).date || iso.slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export const discountLabel = (type: Discount, value: number) => (type === 'percentage' ? `${value}%` : `${value} off`);

/** The tax rate as the fraction the database stores: 0.16, never 16. */
export const taxRateProperty: JsonSchema = { type: 'number', description: 'A fraction from 0 to 1: 0.16 for 16%' };
export const readTaxRate = (args: Record<string, unknown>) => optAmount(args, 'taxRate', { min: 0, max: 1 });

const lineBase: Record<string, JsonSchema> = {
  description: { type: 'string', description: 'What the line is for (max 280)' },
  quantity: { type: 'number', description: 'More than 0' },
  unitPrice: { type: 'number' },
  taxable: { type: 'boolean', description: 'Default true' },
  discountType: { type: 'string', enum: [...DISCOUNT_TYPES] },
  discountValue: { type: 'number', description: 'Percent (0-100) or an amount, by discountType' },
  productId: { type: 'integer', description: 'Catalogue product (list_products); null unlinks', nullable: true },
};

export const quoteLineProperties: Record<string, JsonSchema> = {
  description: lineBase.description,
  quantity: lineBase.quantity,
  days: { type: 'number', description: 'Days covered, default 1. Line total = quantity × days × unitPrice' },
  unitPrice: lineBase.unitPrice,
  taxable: lineBase.taxable,
  discountType: lineBase.discountType,
  discountValue: lineBase.discountValue,
  productId: lineBase.productId,
};

/** No `days`: invoice lines have no such column, so a line saved with it would change its total on the next edit. */
export const invoiceLineProperties: Record<string, JsonSchema> = lineBase;

export const lineListSchema = (properties: Record<string, JsonSchema>, description: string): JsonSchema => ({
  type: 'array',
  description,
  items: { type: 'object', properties, required: ['description', 'quantity', 'unitPrice'] },
});

type LineInput = QuoteItemDraft;

/** A saved line of a quote or an invoice. */
export interface DocLine {
  id: number;
  description: string;
  quantity: number;
  /** Quotes only. */
  days?: number;
  unitPrice: number;
  taxable: boolean;
  discountType: Discount;
  discountValue: number;
  productId: number | null;
  total: number;
}

/** A quote or an invoice, as far as its lines are concerned. */
export interface LineDocument {
  id: number;
  /** Its reference or number. */
  name: string;
  status: string;
  currency: string;
  total: number;
  lines: DocLine[];
}

export function lineView(line: DocLine, index: number) {
  return {
    lineId: line.id,
    position: index + 1,
    description: line.description,
    quantity: line.quantity,
    ...(line.days !== undefined && line.days !== 1 ? { days: line.days } : {}),
    unitPrice: line.unitPrice,
    ...(line.taxable ? {} : { taxable: false }),
    ...(line.discountType !== 'none' ? { discount: discountLabel(line.discountType, line.discountValue) } : {}),
    total: line.total,
    ...(line.productId ? { productId: line.productId } : {}),
  };
}

/** One line as text, so a change to any part of it shows in what an update reports. */
export function lineLabel(line: DocLine): string {
  return [
    line.description,
    `${line.quantity}${line.days !== undefined && line.days !== 1 ? ` × ${line.days}d` : ''} × ${line.unitPrice}`,
    line.discountType !== 'none' ? `less ${discountLabel(line.discountType, line.discountValue)}` : null,
    line.taxable ? null : 'not taxed',
    line.productId ? `product ${line.productId}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** A saved line as the lib takes it back: discount, days and product link included. */
export function draftOf(line: DocLine): LineInput {
  return {
    description: line.description,
    quantity: line.quantity,
    ...(line.days !== undefined ? { days: line.days } : {}),
    unitPrice: line.unitPrice,
    taxable: line.taxable,
    discountType: line.discountType,
    discountValue: line.discountValue,
    productId: line.productId,
  };
}

function checkDiscount(type: string | undefined, value: number | undefined, where: string): void {
  if ((type ?? 'none') === 'none' && (value ?? 0) > 0) {
    throw new ToolRefusal(`${where}discountValue needs a discountType: percentage or fixed.`);
  }
  if (type === 'percentage' && (value ?? 0) > 100) throw new ToolRefusal(`${where}a percentage discount cannot be more than 100.`);
}

/** One line through the page's own schema; what it refuses is refused here, naming the line. */
export function readLine<T extends { discountType?: string; discountValue?: number }>(schema: ZodType<T>, raw: unknown, label: string): T {
  let line: T;
  try {
    line = parseWith(schema, raw);
  } catch (error) {
    if (error instanceof ToolRefusal) throw new ToolRefusal(`${label}: ${error.message}`);
    throw error;
  }
  checkDiscount(line.discountType, line.discountValue, `${label}: `);
  return line;
}

/** A whole set of lines. An empty one is refused: it would delete every line the document has. */
export function readLines<T extends { discountType?: string; discountValue?: number }>(
  schema: ZodType<T>,
  value: unknown,
  kind: 'quote' | 'invoice',
): T[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ToolRefusal(
      `items cannot be empty: ${kind === 'quote' ? 'a quote' : 'an invoice'} needs at least one line. Nothing was changed. To take one line off, use remove_${kind}_line.`,
    );
  }
  if (value.length > 100) throw new ToolRefusal(`items holds ${value.length} lines; the limit is 100.`);
  return value.map((raw, index) => readLine(schema, raw, `Line ${index + 1}`));
}

/** Every catalogue product a set of new lines points at has to exist. */
export async function requireProducts(lines: Array<{ productId?: number | null }>): Promise<void> {
  const ids = [...new Set(lines.map((line) => line.productId).filter((id): id is number => typeof id === 'number'))];
  for (const id of ids) {
    if (!(await getProductById(id))) throw new ToolRefusal(`Product ${id} is not in the catalogue. Find it with list_products.`);
  }
}

/** The document-level discount as it would stand after this call, or `null` when the call leaves it alone. */
export function readDiscount(
  args: Record<string, unknown>,
  current: { discountType: Discount; discountValue: number },
): { discountType: Discount; discountValue: number } | null {
  const type = optEnum(args, 'discountType', DISCOUNT_TYPES);
  const value = optAmount(args, 'discountValue', { min: 0, max: 100_000_000 });
  if (type === undefined && value === undefined) return null;
  const discountType = type ?? current.discountType;
  // Turning the discount off takes its amount with it.
  const discountValue = value ?? (type === 'none' ? 0 : current.discountValue);
  checkDiscount(discountType, discountValue, '');
  return { discountType, discountValue };
}

export const discountProperties: Record<string, JsonSchema> = {
  discountType: { type: 'string', enum: [...DISCOUNT_TYPES], description: 'Discount on the whole document' },
  discountValue: { type: 'number', description: 'Percent (0-100) or an amount, by discountType' },
};

/**
 * The pages' update schemas put a default currency and "no discount" back in
 * when those are left out; passed on, they would reset both on every partial
 * change. Only what the call actually gave goes to the lib.
 */
export function onlyGiven<T extends object>(parsed: T, given: Record<string, unknown>): Partial<T> {
  return Object.fromEntries(Object.entries(parsed).filter(([key]) => key in given)) as Partial<T>;
}

/** What the builders start a new document with: the company's currency and tax rate, and its default brand. */
export async function documentDefaults(): Promise<{ currency: string; taxRate: number; brandProfileId: number | null }> {
  const [organization, brands] = await Promise.all([getOrganizationSettings(), listBrandProfiles({ includeArchived: false })]);
  return {
    currency: organization.defaultCurrency || 'USD',
    taxRate: organization.defaultTaxRate ?? 0,
    brandProfileId: brands.find((brand) => brand.isDefault)?.id ?? null,
  };
}

export async function requireCustomer(customerId: number): Promise<{ id: number; name: string }> {
  const customer = await getCustomerById(customerId);
  if (!customer) throw new ToolRefusal(`Client ${customerId} was not found. Find the client with list_customers.`);
  return customer;
}

/** Which line a call means: by its id, or by where it sits (1 is the first). */
function pickLine(doc: LineDocument, args: Record<string, unknown>, kind: string): number {
  const lineId = optId(args, 'lineId');
  const position = optAmount(args, 'position', { min: 1, integer: true });
  if (lineId && position !== undefined) throw new ToolRefusal('Give lineId or position, not both.');
  if (position !== undefined) {
    if (position > doc.lines.length) {
      throw new ToolRefusal(`${doc.name} has ${doc.lines.length} line${doc.lines.length === 1 ? '' : 's'}; there is no line ${position}.`);
    }
    return position - 1;
  }
  if (!lineId) throw new ToolRefusal(`Say which line: lineId or position (1 is the first), from get_${kind}.`);
  const index = doc.lines.findIndex((line) => line.id === lineId);
  if (index < 0) {
    throw new ToolRefusal(
      `Line ${lineId} is not on ${doc.name}. Line ids change whenever the lines are saved: read it again with get_${kind}, or use position.`,
    );
  }
  return index;
}

export interface LineToolsConfig {
  kind: 'quote' | 'invoice';
  idKey: 'quoteId' | 'invoiceId';
  /** What the result calls the document's name: a quote's reference, an invoice's number. */
  nameKey: 'reference' | 'number';
  requiredModule: string | readonly string[];
  properties: Record<string, JsonSchema>;
  schema: ZodType<LineInput>;
  load: (id: number, ctx: ToolContext) => Promise<LineDocument>;
  /** Writes the whole set back and records the change. */
  save: (doc: LineDocument, lines: LineInput[], ctx: ToolContext, change: 'added' | 'updated' | 'removed') => Promise<LineDocument>;
  href: (id: number) => string;
}

/**
 * Add, change and remove one line. The lib only replaces a document's lines as
 * a set, so each of these reads the set as it stands (discounts, days and
 * product links included), changes the one line, and writes the set back.
 */
export function lineTools(config: LineToolsConfig): ToolDefinition[] {
  const { kind, idKey, nameKey } = config;
  const lineKeys = Object.keys(config.properties);
  const given = (args: Record<string, unknown>) =>
    Object.fromEntries(lineKeys.filter((key) => args[key] !== undefined).map((key) => [key, args[key]]));
  const idProperty: JsonSchema = { type: 'integer' };
  const which: Record<string, JsonSchema> = {
    lineId: { type: 'integer', description: `From get_${kind}` },
    position: { type: 'integer', description: 'Or where the line sits: 1 is the first' },
  };
  const result = (after: LineDocument, before: LineDocument, extra: Record<string, unknown>, summary: string) => ({
    [idKey]: after.id,
    [nameKey]: after.name,
    status: after.status,
    ...extra,
    total: { from: before.total, to: after.total },
    currency: after.currency,
    lines: after.lines.map(lineView),
    href: config.href(after.id),
    summary: `${summary} (total ${money(before.total, before.currency)} to ${money(after.total, after.currency)})`,
  });

  const add: ToolDefinition = {
    destructive: false,
    requiredModule: config.requiredModule,
    functionDeclaration: {
      name: `add_${kind}_line`,
      description: `Add one line to a draft ${kind}. The lines already on it are kept.`,
      parameters: {
        type: 'object',
        properties: {
          [idKey]: idProperty,
          ...config.properties,
          position: { type: 'integer', description: 'Where it goes (1 = first); default last' },
        },
        required: [idKey, 'description', 'quantity', 'unitPrice'],
      },
    },
    async handler(args, ctx) {
      const before = await config.load(reqId(args, idKey, `use list_${kind}s`), ctx);
      if (before.lines.length >= 100) throw new ToolRefusal(`${before.name} already has 100 lines, the most it can hold.`);
      const line = readLine(config.schema, given(args), 'The new line');
      const at = optAmount(args, 'position', { min: 1, max: before.lines.length + 1, integer: true }) ?? before.lines.length + 1;
      await requireProducts([line]);
      const lines = before.lines.map(draftOf);
      lines.splice(at - 1, 0, line);
      const after = await config.save(before, lines, ctx, 'added');
      const saved = after.lines[at - 1];
      return result(after, before, saved ? { added: lineView(saved, at - 1) } : {}, `Added "${line.description}" to ${kind} ${after.name}`);
    },
  };

  const update: ToolDefinition = {
    destructive: false,
    requiredModule: config.requiredModule,
    functionDeclaration: {
      name: `update_${kind}_line`,
      description: `Change one line of a draft ${kind}; the other lines are left alone. Send only what should change.`,
      parameters: { type: 'object', properties: { [idKey]: idProperty, ...which, ...config.properties }, required: [idKey] },
    },
    async handler(args, ctx) {
      const before = await config.load(reqId(args, idKey, `use list_${kind}s`), ctx);
      const index = pickLine(before, args, kind);
      const patch = given(args);
      if (Object.keys(patch).length === 0) throw new ToolRefusal('Say what to change on the line.');
      // Turning a line's discount off takes its amount with it.
      if (patch.discountType === 'none' && patch.discountValue === undefined) patch.discountValue = 0;
      const was = draftOf(before.lines[index]);
      const line = readLine(config.schema, { ...was, ...patch }, `Line ${index + 1}`);
      const changed = changedFields({ ...was }, { ...line }, lineKeys);
      requireChange(changed, `line ${index + 1} of ${before.name}`);
      if (typeof patch.productId === 'number') await requireProducts([line]);
      const lines = before.lines.map(draftOf);
      lines[index] = line;
      const after = await config.save(before, lines, ctx, 'updated');
      const saved = after.lines[index];
      return result(
        after,
        before,
        { ...(saved ? { line: lineView(saved, index) } : {}), changed },
        `Updated line ${index + 1} ("${line.description}") of ${kind} ${after.name}: ${Object.keys(changed).join(', ')}`,
      );
    },
  };

  // An edit to a draft, like the other two: the result shows what went and what is left.
  const remove: ToolDefinition = {
    destructive: false,
    requiredModule: config.requiredModule,
    functionDeclaration: {
      name: `remove_${kind}_line`,
      description: `Take one line off a draft ${kind}. The last remaining line cannot be removed.`,
      parameters: { type: 'object', properties: { [idKey]: idProperty, ...which }, required: [idKey] },
    },
    async handler(args, ctx) {
      const before = await config.load(reqId(args, idKey, `use list_${kind}s`), ctx);
      const index = pickLine(before, args, kind);
      if (before.lines.length === 1) {
        throw new ToolRefusal(
          `"${before.lines[0].description}" is the only line on ${before.name}, and ${kind === 'quote' ? 'a quote' : 'an invoice'} needs at least one. Change the line, or delete the ${kind}.`,
        );
      }
      const gone = before.lines[index];
      const lines = before.lines.map(draftOf);
      lines.splice(index, 1);
      const after = await config.save(before, lines, ctx, 'removed');
      return result(after, before, { removed: lineView(gone, index) }, `Removed "${gone.description}" from ${kind} ${after.name}`);
    },
  };

  return [add, update, remove];
}

// --- Quotes ------------------------------------------------------------------------

const QUOTE_LINE = quoteCreateSchema.shape.items.element as ZodType<LineInput>;

async function loadQuote(id: number, ctx: ToolContext): Promise<QuoteDetail> {
  const quote = await getQuoteForUser({ id, userId: ctx.userId, isAdmin: ctx.isAdmin });
  if (!quote) throw new ToolRefusal(`Quote ${id} was not found, or this user cannot see it. Find it with list_quotes.`);
  return quote;
}

const quoteDocument = (quote: QuoteDetail): LineDocument => ({
  id: quote.id,
  name: quote.reference,
  status: quote.status,
  currency: quote.currency,
  total: quote.total,
  lines: quote.items,
});

/** An approver has to be someone else, and active: the checks the quote page makes when one is picked. */
async function requireApprover(approverId: number, ctx: ToolContext): Promise<void> {
  if (approverId === ctx.userId) throw new ToolRefusal('You cannot assign yourself as the approver.');
  const candidates = await listApproverCandidates(ctx.userId);
  if (!candidates.some((user) => user.id === approverId)) {
    throw new ToolRefusal(`User ${approverId} is not available as an approver. Pick one with list_quote_approvers.`);
  }
}

const listQuotesTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'list_quotes',
    description:
      'Find quotes this user created or approves (admins: all), most recently changed first. Search by reference, subject or client; filter by status or client. 20 per page.',
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Reference (QT-2026-0012), subject or client name' },
        status: { type: 'string', enum: [...QUOTE_STATUSES] },
        customerId: { type: 'integer' },
        awaitingMyApproval: { type: 'boolean', description: 'Only quotes submitted to this user to approve' },
        page: { type: 'integer' },
      },
    },
  },
  async handler(args, ctx) {
    const q = asString(args.q);
    const status = optEnum(args, 'status', QUOTE_STATUSES);
    const customerId = optId(args, 'customerId');
    const mine = optFlag(args, 'awaitingMyApproval') === true;
    const rows = (await listQuotesForUser({ userId: ctx.userId, isAdmin: ctx.isAdmin })).filter(
      (quote) =>
        (!status || quote.status === status) &&
        (!customerId || quote.customer.id === customerId) &&
        (!mine || (quote.status === 'Submitted' && quote.approver?.id === ctx.userId)) &&
        matches(q, quote.reference, quote.subject, quote.customer.name, quote.customer.company, quote.trackingCode),
    );
    const page = pageOf(rows, args, PAGE_SIZE);
    return {
      total: page.total,
      page: page.page,
      more: page.more,
      quotes: page.rows.map((quote) => ({
        id: quote.id,
        reference: quote.reference,
        subject: quote.subject,
        status: quote.status,
        client: quote.customer.name,
        total: quote.total,
        currency: quote.currency,
        issueDate: dateOf(quote.issueDate, ctx.timeZone),
        expiryDate: dateOf(quote.expiryDate, ctx.timeZone),
        approver: quote.approver?.name ?? null,
        href: quoteHref(quote.id),
      })),
    };
  },
};

const getQuoteTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'get_quote',
    description: 'Open one quote: client, dates, totals, approver, and every line with its id and position. Read it before changing it.',
    parameters: { type: 'object', properties: { quoteId: { type: 'integer' } }, required: ['quoteId'] },
  },
  async handler(args, ctx) {
    const quote = await loadQuote(reqId(args, 'quoteId', 'use list_quotes'), ctx);
    return {
      id: quote.id,
      reference: quote.reference,
      subject: quote.subject,
      status: quote.status,
      client: { id: quote.customer.id, name: quote.customer.name, email: quote.customer.email },
      issueDate: dateOf(quote.issueDate, ctx.timeZone),
      expiryDate: dateOf(quote.expiryDate, ctx.timeZone),
      currency: quote.currency,
      taxRate: quote.taxRate,
      subtotal: quote.subtotal,
      tax: quote.tax,
      ...(quote.discountType !== 'none'
        ? { discount: discountLabel(quote.discountType, quote.discountValue), discountAmount: quote.discountAmount }
        : {}),
      total: quote.total,
      approver: quote.approver ? { id: quote.approver.id, name: quote.approver.name } : null,
      createdBy: quote.createdBy.name,
      company: quote.brandProfile?.name ?? null,
      notes: clip(quote.notes, 600),
      terms: clip(quote.terms, 600),
      ...(quote.decisionNote ? { decisionNote: quote.decisionNote } : {}),
      ...(quote.trip ? { trip: quote.trip.reference } : {}),
      lines: quote.items.map(lineView),
      href: quoteHref(quote.id),
    };
  },
};

const listQuoteApproversTool: ToolDefinition = {
  destructive: false,
  requiredModule: API_ACCESS.quoteBranding,
  functionDeclaration: {
    name: 'list_quote_approvers',
    description: 'People who can be set as the approver of a quote (every active user but this one). Returns the approverId.',
    parameters: { type: 'object', properties: { q: { type: 'string', description: 'Name or email' } } },
  },
  async handler(args, ctx) {
    const q = asString(args.q);
    const rows = (await listApproverCandidates(ctx.userId)).filter((user) => matches(q, user.name, user.email));
    return { total: rows.length, approvers: rows.slice(0, 40).map((user) => ({ approverId: user.id, name: user.name, email: user.email })) };
  },
};

const createQuoteTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'create_quote',
    description:
      "Create a draft quote for a client. Left out: issue date is today, expiry 30 days after, currency and tax rate are the company's defaults. Give approverId (list_quote_approvers) if it is to be submitted for approval.",
    parameters: {
      type: 'object',
      properties: {
        customerId: { type: 'integer' },
        subject: { type: 'string' },
        items: lineListSchema(quoteLineProperties, 'The lines, at least one'),
        issueDate: { type: 'string', description: 'YYYY-MM-DD' },
        expiryDate: { type: 'string', description: 'YYYY-MM-DD' },
        currency: { type: 'string', description: '3-letter code' },
        taxRate: taxRateProperty,
        approverId: { type: 'integer' },
        ...discountProperties,
        notes: { type: 'string' },
        terms: { type: 'string' },
      },
      required: ['customerId', 'subject', 'items'],
    },
  },
  async handler(args, ctx) {
    const customerId = reqId(args, 'customerId', 'find the client with list_customers');
    const subject = reqText(args, 'subject', { max: 200 });
    const items = readLines(QUOTE_LINE, args.items, 'quote');
    const issueDate = optDate(args, 'issueDate') ?? todayIn(ctx.timeZone);
    const expiryDate = optDate(args, 'expiryDate') ?? addDays(issueDate, 30);
    if (expiryDate < issueDate) throw new ToolRefusal(`expiryDate (${expiryDate}) is before issueDate (${issueDate}).`);
    const currency = optCurrency(args);
    const taxRate = readTaxRate(args);
    const approverId = optId(args, 'approverId') ?? null;
    const discount = readDiscount(args, { discountType: 'none', discountValue: 0 }) ?? { discountType: 'none' as const, discountValue: 0 };
    const notes = optText(args, 'notes', { max: 2000 }) ?? null;
    const terms = optText(args, 'terms', { max: 5000 }) ?? null;

    // The same order as the quote page: the client, the approver, then the company it goes out under.
    await requireCustomer(customerId);
    if (approverId) await requireApprover(approverId, ctx);
    await requireProducts(items);
    const defaults = await documentDefaults();

    const data = parseWith(quoteCreateSchema, {
      customerId,
      approverId,
      brandProfileId: defaults.brandProfileId,
      subject,
      issueDate,
      expiryDate,
      currency: currency ?? defaults.currency,
      taxRate: taxRate ?? defaults.taxRate,
      ...discount,
      notes,
      terms,
      items,
    });
    const quote = await createQuote({
      customerId: data.customerId,
      approverId: data.approverId ?? null,
      brandProfileId: data.brandProfileId ?? null,
      subject: data.subject,
      issueDate: data.issueDate,
      expiryDate: data.expiryDate,
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
      action: 'quote.created',
      entityType: 'quote',
      entityId: String(quote.id),
      actorUserId: ctx.userId,
      metadata: { reference: quote.reference, customerId: quote.customer.id, via: 'assistant' },
      request: ctx.request,
    });
    return {
      id: quote.id,
      reference: quote.reference,
      status: quote.status,
      client: quote.customer.name,
      issueDate: dateOf(quote.issueDate, ctx.timeZone),
      expiryDate: dateOf(quote.expiryDate, ctx.timeZone),
      currency: quote.currency,
      taxRate: quote.taxRate,
      total: quote.total,
      approver: quote.approver?.name ?? null,
      lines: quote.items.length,
      href: quoteHref(quote.id),
      summary: `Created quote ${quote.reference} for ${quote.customer.name}: ${money(quote.total, quote.currency)}`,
    };
  },
};

const quoteFacts = (quote: QuoteDetail, timeZone: string): Record<string, unknown> => ({
  subject: quote.subject,
  status: quote.status,
  issueDate: dateOf(quote.issueDate, timeZone),
  expiryDate: dateOf(quote.expiryDate, timeZone),
  currency: quote.currency,
  taxRate: quote.taxRate,
  discount: quote.discountType === 'none' ? null : discountLabel(quote.discountType, quote.discountValue),
  approver: quote.approver?.name ?? null,
  notes: quote.notes,
  terms: quote.terms,
  lines: quote.items.map(lineLabel),
  total: quote.total,
});

const QUOTE_FIELDS = Object.keys({
  subject: 1, status: 1, issueDate: 1, expiryDate: 1, currency: 1, taxRate: 1, discount: 1, approver: 1, notes: 1, terms: 1, lines: 1, total: 1,
});

/** Long text and long line lists are cut down in what an update reports back. */
export function trimChanges(changed: Record<string, { from: unknown; to: unknown }>): void {
  for (const key of ['notes', 'terms']) {
    if (changed[key]) changed[key] = { from: clip(changed[key].from as string | null, 120), to: clip(changed[key].to as string | null, 120) };
  }
  const lines = changed.lines as { from: string[]; to: string[] } | undefined;
  if (lines && (lines.from.length > 8 || lines.to.length > 8)) {
    changed.lines = { from: `${lines.from.length} lines`, to: `${lines.to.length} lines` };
  }
}

const updateQuoteTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'update_quote',
    description:
      'Change a draft quote: subject, dates, currency, tax rate, discount, approver, notes, terms. Send only what should change. `items` REPLACES every line: to add, change or remove one line use the line tools.',
    parameters: {
      type: 'object',
      properties: {
        quoteId: { type: 'integer' },
        subject: { type: 'string' },
        issueDate: { type: 'string', description: 'YYYY-MM-DD' },
        expiryDate: { type: 'string', description: 'YYYY-MM-DD' },
        currency: { type: 'string', description: '3-letter code' },
        taxRate: taxRateProperty,
        approverId: { type: 'integer', description: 'From list_quote_approvers; null clears it', nullable: true },
        ...discountProperties,
        notes: { type: 'string', description: 'null clears', nullable: true },
        terms: { type: 'string', description: 'null clears', nullable: true },
        items: lineListSchema(quoteLineProperties, 'Replaces ALL lines; at least one'),
      },
      required: ['quoteId'],
    },
  },
  async handler(args, ctx) {
    const id = reqId(args, 'quoteId', 'use list_quotes');
    const before = await loadQuote(id, ctx);

    const input: Record<string, unknown> = {};
    const subject = optText(args, 'subject', { max: 200 });
    if (subject != null) input.subject = subject;
    for (const key of ['issueDate', 'expiryDate'] as const) {
      const value = optDate(args, key);
      if (value) input[key] = value;
    }
    const currency = optCurrency(args);
    if (currency) input.currency = currency;
    const taxRate = readTaxRate(args);
    if (taxRate !== undefined) input.taxRate = taxRate;
    const approverId = optId(args, 'approverId');
    if (approverId !== undefined) input.approverId = approverId;
    const discount = readDiscount(args, before);
    if (discount) Object.assign(input, discount);
    for (const [key, max] of [['notes', 2000], ['terms', 5000]] as const) {
      const value = optText(args, key, { max });
      if (value !== undefined) input[key] = value;
    }
    if (args.items !== undefined) input.items = readLines(QUOTE_LINE, args.items, 'quote');

    if (Object.keys(input).length === 0) throw new ToolRefusal('Say what to change on the quote.');
    const issue = (input.issueDate as string | undefined) ?? dateOf(before.issueDate, ctx.timeZone)!;
    const expiry = (input.expiryDate as string | undefined) ?? dateOf(before.expiryDate, ctx.timeZone)!;
    if (expiry < issue) throw new ToolRefusal(`The expiry date (${expiry}) would be before the issue date (${issue}).`);
    if (approverId) await requireApprover(approverId, ctx);
    if (input.items) await requireProducts(input.items as LineInput[]);

    const data = onlyGiven(parseWith(quoteUpdateSchema, input), input) as QuoteUpdateInput;
    const after = settle(await updateDraftQuote({ id, userId: ctx.userId, isAdmin: ctx.isAdmin, input: data }));

    const changed = changedFields(quoteFacts(before, ctx.timeZone), quoteFacts(after, ctx.timeZone), QUOTE_FIELDS);
    requireChange(changed, `quote ${before.reference}`);
    trimChanges(changed);
    await audit({
      action: 'quote.updated',
      entityType: 'quote',
      entityId: String(id),
      actorUserId: ctx.userId,
      metadata: { reference: after.reference, fields: Object.keys(changed), via: 'assistant' },
      request: ctx.request,
    });
    return {
      id,
      reference: after.reference,
      status: after.status,
      total: after.total,
      currency: after.currency,
      changed,
      href: quoteHref(id),
      summary: `Updated quote ${after.reference}: ${Object.keys(changed).join(', ')}`,
    };
  },
};

const quoteLineTools = lineTools({
  kind: 'quote',
  idKey: 'quoteId',
  nameKey: 'reference',
  requiredModule: MODULE,
  properties: quoteLineProperties,
  schema: QUOTE_LINE,
  href: quoteHref,
  load: async (id, ctx) => quoteDocument(await loadQuote(id, ctx)),
  async save(doc, lines, ctx, change) {
    const after = settle(await updateDraftQuote({ id: doc.id, userId: ctx.userId, isAdmin: ctx.isAdmin, input: { items: lines } }));
    await audit({
      action: 'quote.updated',
      entityType: 'quote',
      entityId: String(doc.id),
      actorUserId: ctx.userId,
      metadata: { reference: after.reference, line: change, via: 'assistant' },
      request: ctx.request,
    });
    return quoteDocument(after);
  },
});

const reference = (args: Record<string, unknown>) => asString(args.reference) ?? `#${args.quoteId}`;
const referenceProperty: JsonSchema = { type: 'string', description: "The quote's reference, shown to the user when they confirm" };

/** What the user was shown on the Confirm card has to be the record the call acts on. */
function requireNamed(args: Record<string, unknown>, quote: QuoteDetail): void {
  const given = asString(args.reference);
  if (given && given.toLowerCase() !== quote.reference.toLowerCase()) {
    throw new ToolRefusal(`Quote ${quote.id} is ${quote.reference}, not ${given}. Nothing was done: check which quote is meant.`);
  }
}

const submitQuoteTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'submit_quote',
    description: 'Submit a draft or declined quote to its approver, who is notified. The quote needs an approver first (update_quote).',
    parameters: { type: 'object', properties: { quoteId: { type: 'integer' } }, required: ['quoteId'] },
  },
  async handler(args, ctx) {
    const id = reqId(args, 'quoteId', 'use list_quotes');
    const result = await submitQuote({ id, userId: ctx.userId, isAdmin: ctx.isAdmin });
    if ('error' in result) {
      throw new ToolRefusal(
        result.error === 'Assign an approver before submitting'
          ? 'This quote has no approver. Set one with update_quote (approverId from list_quote_approvers), then submit.'
          : result.error,
      );
    }
    await audit({
      action: 'quote.submitted',
      entityType: 'quote',
      entityId: String(id),
      actorUserId: ctx.userId,
      targetUserId: result.approver?.id ?? null,
      metadata: { reference: result.reference, via: 'assistant' },
      request: ctx.request,
    });
    return {
      id,
      reference: result.reference,
      status: result.status,
      approver: result.approver?.name ?? null,
      href: quoteHref(id),
      summary: `Submitted quote ${result.reference} to ${result.approver?.name ?? 'its approver'} for approval`,
    };
  },
};

const decideQuoteTool: ToolDefinition = {
  destructive: true,
  requiredModule: MODULE,
  confirmLabel: (args) => `${args.decision === 'declined' ? 'Decline' : 'Approve'} quote ${reference(args)}`,
  functionDeclaration: {
    name: 'decide_quote',
    description: 'Approve or decline a submitted quote, as its assigned approver (or an admin). The creator is notified.',
    parameters: {
      type: 'object',
      properties: {
        quoteId: { type: 'integer' },
        decision: { type: 'string', enum: ['approved', 'declined'] },
        note: { type: 'string', description: 'Reason, shown to the creator' },
        reference: referenceProperty,
      },
      required: ['quoteId', 'decision'],
    },
  },
  async handler(args, ctx) {
    const id = reqId(args, 'quoteId', 'use list_quotes');
    const { decision, note } = parseWith(quoteDecisionSchema, {
      decision: optEnum(args, 'decision', ['approved', 'declined'] as const),
      note: optText(args, 'note', { max: 1000 }) ?? null,
    });
    requireNamed(args, await loadQuote(id, ctx));
    const result = settle(await decideQuote({ id, userId: ctx.userId, isAdmin: ctx.isAdmin, decision, note: note ?? null }));
    await audit({
      action: decision === 'approved' ? 'quote.approved' : 'quote.declined',
      entityType: 'quote',
      entityId: String(id),
      actorUserId: ctx.userId,
      targetUserId: result.createdBy.id,
      metadata: { reference: result.reference, trackingCode: result.trackingCode, note: note ?? null, via: 'assistant' },
      request: ctx.request,
    });
    return {
      id,
      reference: result.reference,
      status: result.status,
      href: quoteHref(id),
      summary: `${decision === 'approved' ? 'Approved' : 'Declined'} quote ${result.reference}`,
    };
  },
};

const sendQuoteTool: ToolDefinition = {
  destructive: true,
  requiredModule: MODULE,
  confirmLabel: (args) => `Email quote ${reference(args)} to the client and mark it Sent`,
  functionDeclaration: {
    name: 'send_quote',
    description: 'Email an APPROVED quote to its client as a PDF and mark it Sent. Refused when email is not set up or the client has no address.',
    parameters: { type: 'object', properties: { quoteId: { type: 'integer' }, reference: referenceProperty }, required: ['quoteId'] },
  },
  async handler(args, ctx) {
    const id = reqId(args, 'quoteId', 'use list_quotes');
    const quote = await loadQuote(id, ctx);
    requireNamed(args, quote);
    // Checked before anything goes out, in the quote page's order, so a quote that can't be dispatched is never emailed.
    if (!ctx.isAdmin && quote.createdBy.id !== ctx.userId) throw new ToolRefusal('Only the creator can dispatch this quote.');
    if (quote.status !== 'Approved') {
      throw new ToolRefusal(`Quote ${quote.reference} is ${quote.status}. Only an approved quote can be sent.`);
    }
    if (!isEmailConfigured()) throw new ToolRefusal('Email is not set up yet. An admin configures SMTP under Admin → Email. Nothing was sent.');
    if (!quote.customer.email) {
      throw new ToolRefusal(`${quote.customer.name} has no email address on file. Add one (update_customer) before sending. Nothing was sent.`);
    }

    let emailedTo: string;
    try {
      emailedTo = (await emailQuoteToCustomer(quote)).to;
    } catch (error) {
      throw new ToolRefusal(
        `${error instanceof EmailError ? error.message : 'Could not send the quote email.'} The quote was not marked Sent.`,
      );
    }

    const sent = await markQuoteSent({ id, userId: ctx.userId, isAdmin: ctx.isAdmin });
    if ('error' in sent) {
      throw new ToolRefusal(`The email went to ${emailedTo}, but the quote could not be marked Sent: ${sent.error}`);
    }
    await audit({
      action: 'quote.sent',
      entityType: 'quote',
      entityId: String(id),
      actorUserId: ctx.userId,
      metadata: { reference: sent.reference, emailedTo, via: 'assistant' },
      request: ctx.request,
    });
    return {
      id,
      reference: sent.reference,
      status: sent.status,
      emailedTo,
      href: quoteHref(id),
      summary: `Emailed quote ${sent.reference} to ${emailedTo} and marked it Sent`,
    };
  },
};

const duplicateQuoteTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'duplicate_quote',
    description: 'Copy a quote into a new draft (same client, lines and approver; issued today, expiring in 30 days).',
    parameters: { type: 'object', properties: { quoteId: { type: 'integer' } }, required: ['quoteId'] },
  },
  async handler(args, ctx) {
    const id = reqId(args, 'quoteId', 'use list_quotes');
    const copy = settle(await duplicateQuote({ id, userId: ctx.userId, isAdmin: ctx.isAdmin }));
    await audit({
      action: 'quote.duplicated',
      entityType: 'quote',
      entityId: String(copy.id),
      actorUserId: ctx.userId,
      metadata: { sourceId: id, reference: copy.reference, via: 'assistant' },
      request: ctx.request,
    });
    return {
      id: copy.id,
      reference: copy.reference,
      status: copy.status,
      total: copy.total,
      currency: copy.currency,
      href: quoteHref(copy.id),
      summary: `Copied quote #${id} to new draft ${copy.reference}`,
    };
  },
};

const deleteQuoteTool: ToolDefinition = {
  destructive: true,
  requiredModule: MODULE,
  confirmLabel: (args) => `Delete quote ${reference(args)} and its lines for good`,
  functionDeclaration: {
    name: 'delete_quote',
    description: 'Delete a draft or declined quote. A submitted, approved or sent quote cannot be deleted. Cannot be undone.',
    parameters: { type: 'object', properties: { quoteId: { type: 'integer' }, reference: referenceProperty }, required: ['quoteId'] },
  },
  async handler(args, ctx) {
    const id = reqId(args, 'quoteId', 'use list_quotes');
    const quote = await loadQuote(id, ctx);
    requireNamed(args, quote);
    const result = await deleteQuote({ id, userId: ctx.userId, isAdmin: ctx.isAdmin });
    if (result !== true) throw new ToolRefusal(result.error);
    await audit({
      action: 'quote.deleted',
      entityType: 'quote',
      entityId: String(id),
      actorUserId: ctx.userId,
      metadata: { reference: quote.reference, via: 'assistant' },
      request: ctx.request,
    });
    return { deleted: true, quoteId: id, reference: quote.reference, summary: `Deleted quote ${quote.reference}` };
  },
};

export const quoteTools: ToolDefinition[] = [
  listQuotesTool,
  getQuoteTool,
  listQuoteApproversTool,
  createQuoteTool,
  updateQuoteTool,
  ...quoteLineTools,
  submitQuoteTool,
  decideQuoteTool,
  sendQuoteTool,
  duplicateQuoteTool,
  deleteQuoteTool,
];
