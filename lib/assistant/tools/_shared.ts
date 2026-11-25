import 'server-only';

import type { ZodType } from 'zod';

import { recordAuditEvent } from '@/lib/audit';
import { utcToZoned, zonedToUtcIso } from '@/lib/zoned-time';

import { asBool, asNumber, asString, type JsonSchema, ToolRefusal } from '../types';

type Args = Record<string, unknown>;

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Today's date on the wall in `timeZone`. */
export function todayIn(timeZone: string): string {
  return utcToZoned(new Date().toISOString(), timeZone).date || todayIso();
}

/**
 * Normalise a model-supplied date to an ISO date string, or a fallback.
 * Lenient: prefer `optDate`/`reqDate`, which refuse what they can't read.
 */
export function dateIso(value: unknown, fallback: string | null): string | null {
  const s = asString(value);
  if (!s) return fallback;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? fallback : s;
}

// --- Strict readers ---------------------------------------------------------
// Each returns the value, `undefined` when the argument was left out, or throws
// a ToolRefusal naming the field. Nothing is dropped, defaulted or guessed: a
// value the tool can't use stops the call, so "done" always means done.

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** A real calendar date written YYYY-MM-DD ("2026-02-30" is not one). */
export function isRealDate(value: string): boolean {
  const m = DATE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** A date; `null` when the caller cleared it (only reachable where the schema allows null). */
export function optDate(args: Args, key: string): string | null | undefined {
  const raw = args[key];
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!isRealDate(text)) throw new ToolRefusal(`${key} must be a real date written YYYY-MM-DD (got "${String(raw).slice(0, 30)}").`);
  return text;
}

export function reqDate(args: Args, key: string): string {
  const value = optDate(args, key);
  if (!value) throw new ToolRefusal(`${key} is required (YYYY-MM-DD).`);
  return value;
}

/** A 24-hour wall-clock time, "09:00". */
export function optTime(args: Args, key: string): string | null | undefined {
  const raw = args[key];
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!TIME.test(text)) throw new ToolRefusal(`${key} must be a 24-hour time written HH:MM (got "${String(raw).slice(0, 30)}").`);
  return text;
}

/** A date and time on the wall in `timeZone`, as the UTC instant the database stores. */
export function toUtc(date: string, time: string, timeZone: string, what = 'time'): string {
  const iso = zonedToUtcIso(date, time, timeZone);
  if (!iso) throw new ToolRefusal(`Could not read the ${what}: ${date} ${time} in ${timeZone}.`);
  return iso;
}

/** A stored instant as "2026-11-25 09:00" on the wall in `timeZone`. */
export function localStamp(iso: string | null | undefined, timeZone: string): string | null {
  if (!iso) return null;
  const { date, time } = utcToZoned(iso, timeZone);
  return date ? `${date} ${time}` : null;
}

/** Text; blank is refused rather than read as "leave it". `null` clears where the schema allows it. */
export function optText(args: Args, key: string, options: { max?: number } = {}): string | null | undefined {
  const raw = args[key];
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  const text = asString(raw);
  if (!text) throw new ToolRefusal(`${key} cannot be blank. Leave it out to keep it as it is.`);
  if (options.max && text.length > options.max) {
    throw new ToolRefusal(`${key} is too long (${text.length} characters; the limit is ${options.max}).`);
  }
  return text;
}

export function reqText(args: Args, key: string, options: { max?: number } = {}): string {
  const value = optText(args, key, options);
  if (!value) throw new ToolRefusal(`${key} is required.`);
  return value;
}

/** One of a fixed set, matched exactly. */
export function optEnum<T extends string>(args: Args, key: string, allowed: readonly T[]): T | undefined {
  const raw = args[key];
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string' || !(allowed as readonly string[]).includes(raw)) {
    throw new ToolRefusal(`${key} must be one of: ${allowed.join(', ')} (got "${String(raw).slice(0, 40)}").`);
  }
  return raw as T;
}

/** A record id. `null` (or 0) clears, where the schema allows it. */
export function optId(args: Args, key: string): number | null | undefined {
  const raw = args[key];
  if (raw === undefined) return undefined;
  if (raw === null || raw === 0 || raw === '0') return null;
  const n = asNumber(raw);
  if (n === undefined || !Number.isInteger(n) || n < 0) {
    throw new ToolRefusal(`${key} must be a record id (a whole number), not "${String(raw).slice(0, 30)}".`);
  }
  return n;
}

export function reqId(args: Args, key: string, hint?: string): number {
  const value = optId(args, key);
  if (!value) throw new ToolRefusal(`${key} is required${hint ? ` (${hint})` : ''}.`);
  return value;
}

/** A number within bounds; text like "5k" or "$1,200" is refused, not read as 0. */
export function optAmount(
  args: Args,
  key: string,
  options: { min?: number; max?: number; integer?: boolean } = {},
): number | undefined {
  const raw = args[key];
  if (raw === undefined || raw === null) return undefined;
  const n = asNumber(raw);
  if (n === undefined) throw new ToolRefusal(`${key} must be a plain number (got "${String(raw).slice(0, 30)}").`);
  if (options.integer && !Number.isInteger(n)) throw new ToolRefusal(`${key} must be a whole number.`);
  const min = options.min ?? 0;
  if (n < min) throw new ToolRefusal(`${key} cannot be less than ${min}.`);
  if (options.max !== undefined && n > options.max) throw new ToolRefusal(`${key} cannot be more than ${options.max}.`);
  return n;
}

export function optFlag(args: Args, key: string): boolean | undefined {
  const raw = args[key];
  if (raw === undefined || raw === null) return undefined;
  const value = asBool(raw);
  if (value === undefined) throw new ToolRefusal(`${key} must be true or false.`);
  return value;
}

/** A three-letter currency code, upper-cased: "USD", "KES", "ZAR". */
export function optCurrency(args: Args, key = 'currency'): string | undefined {
  const raw = args[key];
  if (raw === undefined || raw === null) return undefined;
  const code = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new ToolRefusal(`${key} must be a three-letter currency code such as USD, KES or ZAR (got "${String(raw).slice(0, 30)}").`);
  }
  return code;
}

/**
 * Runs one of the pages' own Zod schemas (lib/validation.ts) over a tool's
 * input, so the assistant accepts exactly what the page would.
 */
export function parseWith<T>(schema: ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const where = issue?.path?.length ? `${issue.path.join('.')}: ` : '';
  throw new ToolRefusal(`${where}${issue?.message ?? 'Invalid input'}`);
}

/** A lib's `{ error }` result, as a refusal; anything else is handed back. */
export function unwrap<T>(result: T | { error: string; status?: number }): T {
  if (result && typeof result === 'object' && 'error' in result && typeof result.error === 'string') {
    throw new ToolRefusal(result.error);
  }
  return result as T;
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * What an update actually changed, field by field. Update tools return this,
 * and refuse when it comes back empty, so a call that altered nothing can
 * never be reported as a change.
 */
export function changedFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: readonly string[],
): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const field of fields) {
    if (!sameValue(before[field], after[field])) out[field] = { from: before[field] ?? null, to: after[field] ?? null };
  }
  return out;
}

export function requireChange(changed: Record<string, unknown>, what: string): void {
  if (Object.keys(changed).length === 0) {
    throw new ToolRefusal(`Nothing to change: ${what} already has those values.`);
  }
}

/**
 * Writes the audit entry for a change that has already been saved. A failure
 * here is logged and swallowed: reporting it as the tool failing would tell
 * the user their change didn't happen when it did.
 */
export async function audit(input: Parameters<typeof recordAuditEvent>[0]): Promise<void> {
  try {
    await recordAuditEvent(input);
  } catch (error) {
    console.error(`[assistant] audit entry "${input.action}" was not written:`, error);
  }
}

/** A page of a list, sliced after the fact, with the paging facts the model needs to ask for more. */
export function pageOf<T>(rows: T[], args: Args, pageSize: number): { rows: T[]; page: number; total: number; more: boolean } {
  const page = Math.max(1, optAmount(args, 'page', { min: 1, integer: true }) ?? 1);
  const start = (page - 1) * pageSize;
  return { rows: rows.slice(start, start + pageSize), page, total: rows.length, more: start + pageSize < rows.length };
}

/** Case-insensitive "does any of these contain the query", for lists small enough to filter in memory. */
export function matches(query: string | undefined, ...fields: Array<string | null | undefined>): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return fields.some((field) => field?.toLowerCase().includes(q));
}

export interface LineItem {
  description: string;
  quantity: number;
  /** Days the line covers (quotes only; invoices ignore it). Defaults to 1. */
  days?: number;
  unitPrice: number;
  taxable?: boolean;
}

/** Coerce a model-supplied items array into validated line items. */
export function parseLineItems(value: unknown): LineItem[] {
  if (!Array.isArray(value)) return [];
  const out: LineItem[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const description = asString(r.description);
    const quantity = asNumber(r.quantity) ?? 1;
    const days = asNumber(r.days);
    const unitPrice = asNumber(r.unitPrice) ?? asNumber(r.price) ?? 0;
    if (!description) continue;
    out.push({
      description,
      quantity,
      ...(days && days > 0 ? { days } : {}),
      unitPrice,
      taxable: asBool(r.taxable),
    });
  }
  return out;
}

/** Shared JSON schema for a quote/invoice line-items array. */
export const lineItemsSchema: JsonSchema = {
  type: 'array',
  description: 'Line items to bill.',
  items: {
    type: 'object',
    properties: {
      description: { type: 'string' },
      quantity: { type: 'number' },
      days: { type: 'number', description: 'Days the line covers (quotes only, default 1)' },
      unitPrice: { type: 'number' },
      taxable: { type: 'boolean' },
    },
    required: ['description', 'quantity', 'unitPrice'],
  },
};
