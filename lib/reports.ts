import 'server-only';

import { Prisma } from '@prisma/client';
import { cache } from 'react';

import { computeStats as computeLicenseStats, listDriverLicenses, type DriverLicenseStats } from './drivers';
import { crossRate, type RateTable } from './exchange-rates';
import type { InvoiceStatus } from './invoices';
import { prisma } from './prisma';
import type { QuoteStatus } from './quotes';
import { ACTIVE_ASSIGNMENT_STATUSES } from './task-assignment';
import type { TripStatus } from './trips';
import { localTimeZone } from './zoned-time';

const INVOICE_STATUSES: InvoiceStatus[] = ['Draft', 'Sent', 'Partial', 'Paid', 'Void'];
const QUOTE_STATUSES: QuoteStatus[] = ['Draft', 'Submitted', 'Approved', 'Declined', 'Sent', 'Expired'];
const TRIP_STATUSES: TripStatus[] = ['Draft', 'Planned', 'Active', 'Completed', 'Cancelled'];

// Quote outcomes for the conversion funnel.
const QUOTE_WON: QuoteStatus[] = ['Approved', 'Sent'];
const QUOTE_LOST: QuoteStatus[] = ['Declined', 'Expired'];

// Invoice statuses that can be overdue (lib/invoices isOverdueStatus).
const OVERDUE_STATUSES = ['Sent', 'Partial'];

const MONTHS_SHOWN = 12;

/** How long a finished report is served as-is before the sums are run again. */
const REPORT_TTL_MS = 3 * 60 * 1000;

export interface MonthBucket {
  key: string; // YYYY-MM
  label: string; // e.g. "Jan 25"
}

export interface FinanceMonthPoint {
  month: string;
  billed: number;
  collected: number;
}

export interface SalesMonthPoint {
  month: string;
  quoted: number;
  approved: number;
}

export interface AgingBuckets {
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90plus: number;
}

export type AgingBucket = keyof AgingBuckets;

export interface ConversionResult {
  won: number;
  lost: number;
  open: number;
  rate: number; // 0–100
}

export interface ResourceUtilization {
  total: number;
  busy: number;
  idle: number;
}

export interface ReportFx {
  /** Every rate applied: one per source currency that differs from the report's. */
  conversions: { from: string; to: string; rate: number }[];
  /** When the provider published the rates used; null when nothing needed converting. */
  asOf: string | null;
  /** The rates are the last saved table because the latest refresh failed. */
  stale: boolean;
  /** Records left out of money totals because no rate exists for their currency. */
  skipped: { invoices: number; quotes: number; currencies: string[] };
}

export interface ReportData {
  generatedAt: string;
  /** Every amount below is in this currency. */
  currency: string;
  fx: ReportFx;
  finance: {
    totalBilled: number;
    totalCollected: number;
    outstanding: number;
    overdue: number;
    collectedThisMonth: number;
    invoiceCount: number;
    paidCount: number;
    statusCounts: Record<string, number>;
    monthly: FinanceMonthPoint[];
    aging: AgingBuckets;
    topCustomers: { name: string; balance: number; overdue: number }[];
  };
  sales: {
    totalQuoted: number;
    approvedValue: number;
    conversionRate: number;
    quoteCount: number;
    statusCounts: Record<string, number>;
    monthly: SalesMonthPoint[];
    winLoss: ConversionResult;
    topCustomers: { name: string; value: number; count: number }[];
  };
  operations: {
    tripStatusCounts: Record<string, number>;
    assignmentStatusCounts: Record<string, number>;
    activeTrips: number;
    totalTrips: number;
    fleet: ResourceUtilization;
    drivers: ResourceUtilization;
    officers: ResourceUtilization;
    utilizationPct: number;
  };
  compliance: {
    license: DriverLicenseStats;
    upcoming: {
      name: string;
      licenseNumber: string;
      category: string;
      expiry: string;
      daysRemaining: number;
      status: string;
    }[];
  };
}

// ─── Pure helpers ───────────────────────────────────────────────────────────────

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** A SUM/COUNT column from a raw query: numeric comes back as Decimal, COUNT as bigint. */
function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  return Number(String(value));
}

/**
 * Re-express each record's money `fields` in `currency`. Records in a
 * currency with no rate come back in `skipped`, so the report leaves them out
 * of the sums and says so instead of adding shillings to dollars. The records
 * are per-currency sums from the database, so one rate converts a whole group.
 */
export function toCurrency<T extends { currency: string }>(
  items: T[],
  fields: readonly (keyof T)[],
  currency: string,
  rates: RateTable | null,
): { converted: T[]; skipped: T[] } {
  const converted: T[] = [];
  const skipped: T[] = [];
  for (const item of items) {
    const rate = crossRate(rates, item.currency, currency);
    if (rate === null) {
      skipped.push(item);
      continue;
    }
    const next = { ...item, currency } as Record<keyof T, unknown>;
    for (const field of fields) next[field] = round2(Number(item[field]) * rate);
    converted.push(next as T);
  }
  return { converted, skipped };
}

/** The last `n` calendar months ending with the month of `now`, oldest first. */
export function lastNMonths(n: number, now: Date = new Date()): MonthBucket[] {
  const buckets: MonthBucket[] = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    buckets.push({ key, label });
  }
  return buckets;
}

/**
 * Lay per-month sums (one row per currency and month, already converted) onto
 * `months`: one row per bucket with every series summed, months with nothing
 * at 0, rows for months outside the window dropped.
 */
export function sumMonthGroups<K extends string>(
  rows: Array<{ month: string } & Record<K, number>>,
  series: readonly K[],
  months: MonthBucket[],
): Record<K, number>[] {
  const index = new Map<string, Record<K, number>>();
  const out = months.map((m) => {
    const row = {} as Record<K, number>;
    for (const k of series) row[k] = 0;
    index.set(m.key, row);
    return row;
  });
  for (const r of rows) {
    const row = index.get(r.month);
    if (!row) continue;
    for (const k of series) row[k] = round2(row[k] + r[k]);
  }
  return out;
}

/** Combine per-currency aging rows (already converted) into the five buckets. */
export function sumAgingGroups(rows: Array<{ bucket: string; balance: number }>): AgingBuckets {
  const buckets: AgingBuckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 };
  for (const r of rows) {
    if (r.bucket in buckets) buckets[r.bucket as AgingBucket] += r.balance;
  }
  return {
    current: round2(buckets.current),
    d1_30: round2(buckets.d1_30),
    d31_60: round2(buckets.d31_60),
    d61_90: round2(buckets.d61_90),
    d90plus: round2(buckets.d90plus),
  };
}

/** Win/loss/open counts and conversion rate (won / decided) from quotes per status. */
export function computeConversion(statusCounts: Record<string, number>): ConversionResult {
  let won = 0;
  let lost = 0;
  let open = 0;
  for (const [status, count] of Object.entries(statusCounts)) {
    if ((QUOTE_WON as string[]).includes(status)) won += count;
    else if ((QUOTE_LOST as string[]).includes(status)) lost += count;
    else open += count;
  }
  const decided = won + lost;
  const rate = decided === 0 ? 0 : Math.round((won / decided) * 100);
  return { won, lost, open, rate };
}

/** Counts per status from a GROUP BY, seeded with every known status at 0. */
export function tallyStatusCounts(
  groups: ReadonlyArray<{ status: string; count: number }>,
  statuses: readonly string[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const s of statuses) counts[s] = 0;
  for (const g of groups) counts[g.status] = (counts[g.status] ?? 0) + g.count;
  return counts;
}

function utilization(total: number, busy: number): ResourceUtilization {
  return { total, busy, idle: Math.max(0, total - busy) };
}

/** "Mastercard Foundation", or the contact's name for a client with no company. */
function customerLabel(c: { name: string; company: string | null }): string {
  return c.company || c.name;
}

/** `now` as the naive-UTC text Prisma's timestamp(3) columns hold, for raw comparisons. */
function utcText(now: Date): string {
  return now.toISOString().slice(0, 23).replace('T', ' ');
}

// ─── Database rows ──────────────────────────────────────────────────────────────

interface StatusGroup {
  status: string;
  count: number;
}

interface InvoiceCurrencyGroup {
  currency: string;
  count: number;
  billed: number;
  collected: number;
  outstanding: number;
  overdue: number;
}

interface QuoteCurrencyGroup {
  currency: string;
  count: number;
  quoted: number;
  approved: number;
}

interface CustomerBalanceGroup {
  customerId: number;
  name: string;
  company: string | null;
  currency: string;
  balance: number;
  overdue: number;
}

interface CustomerQuoteGroup {
  customerId: number;
  name: string;
  company: string | null;
  currency: string;
  value: number;
  count: number;
}

function statusGroups(rows: Array<{ status: string; _count: { _all: number } }>): StatusGroup[] {
  return rows.map((r) => ({ status: r.status, count: r._count._all }));
}

/**
 * Everything the report needs, summed by the database: a handful of GROUP BY
 * queries whose result size is bounded by currencies × months × statuses,
 * however long the invoice, quote and trip history grows.
 */
async function loadReportInputs(now: Date, windowStart: Date) {
  const nowUtc = utcText(now);
  const tz = localTimeZone();
  const activeStatuses = Prisma.join([...ACTIVE_ASSIGNMENT_STATUSES]);
  const wonStatuses = Prisma.join(QUOTE_WON);
  const overdueStatuses = Prisma.join(OVERDUE_STATUSES);

  const [
    invoiceStatuses,
    invoiceGroups,
    invoiceMonths,
    agingRows,
    invoiceCustomers,
    quoteStatuses,
    quoteGroups,
    quoteMonths,
    quoteCustomers,
    tripStatuses,
    assignmentStatuses,
    busyRows,
    vehicleCount,
    driverCount,
    officerCount,
    licenses,
  ] = await Promise.all([
    prisma.invoice.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.$queryRaw<Array<Record<keyof InvoiceCurrencyGroup, unknown>>>`
      SELECT currency,
        COUNT(*)::int AS count,
        COALESCE(SUM(total) FILTER (WHERE status <> 'Void'), 0) AS billed,
        COALESCE(SUM("amountPaid") FILTER (WHERE status <> 'Void'), 0) AS collected,
        COALESCE(SUM(total - "amountPaid") FILTER (WHERE status <> 'Void'), 0) AS outstanding,
        COALESCE(SUM(total - "amountPaid") FILTER (
          WHERE status IN (${overdueStatuses}) AND total - "amountPaid" > 0 AND "dueDate" < ${nowUtc}::timestamp
        ), 0) AS overdue
      FROM "Invoice"
      GROUP BY currency`,
    prisma.$queryRaw<Array<{ currency: string; month: string; billed: unknown; collected: unknown }>>`
      SELECT currency,
        to_char(("issueDate" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM') AS month,
        SUM(total) AS billed,
        SUM("amountPaid") AS collected
      FROM "Invoice"
      WHERE status <> 'Void' AND "issueDate" >= ${utcText(windowStart)}::timestamp
      GROUP BY currency, month`,
    prisma.$queryRaw<Array<{ currency: string; bucket: string; balance: unknown }>>`
      SELECT currency, bucket, SUM(balance) AS balance FROM (
        SELECT currency, total - "amountPaid" AS balance,
          CASE
            WHEN NOT (status IN (${overdueStatuses}) AND "dueDate" < ${nowUtc}::timestamp) THEN 'current'
            WHEN FLOOR(EXTRACT(EPOCH FROM (${nowUtc}::timestamp - "dueDate")) / 86400) <= 30 THEN 'd1_30'
            WHEN FLOOR(EXTRACT(EPOCH FROM (${nowUtc}::timestamp - "dueDate")) / 86400) <= 60 THEN 'd31_60'
            WHEN FLOOR(EXTRACT(EPOCH FROM (${nowUtc}::timestamp - "dueDate")) / 86400) <= 90 THEN 'd61_90'
            ELSE 'd90plus'
          END AS bucket
        FROM "Invoice"
        WHERE status <> 'Void' AND total - "amountPaid" > 0
      ) b
      GROUP BY currency, bucket`,
    prisma.$queryRaw<Array<Record<keyof CustomerBalanceGroup, unknown>>>`
      SELECT i."customerId" AS "customerId", c.name, c.company, i.currency,
        SUM(i.total - i."amountPaid") AS balance,
        COALESCE(SUM(i.total - i."amountPaid") FILTER (
          WHERE i.status IN (${overdueStatuses}) AND i."dueDate" < ${nowUtc}::timestamp
        ), 0) AS overdue
      FROM "Invoice" i
      JOIN "Customer" c ON c.id = i."customerId"
      WHERE i.status <> 'Void' AND i.total - i."amountPaid" > 0
      GROUP BY i."customerId", c.name, c.company, i.currency`,
    prisma.quote.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.$queryRaw<Array<Record<keyof QuoteCurrencyGroup, unknown>>>`
      SELECT currency,
        COUNT(*)::int AS count,
        COALESCE(SUM(total), 0) AS quoted,
        COALESCE(SUM(total) FILTER (WHERE status IN (${wonStatuses})), 0) AS approved
      FROM "Quote"
      GROUP BY currency`,
    prisma.$queryRaw<Array<{ currency: string; month: string; quoted: unknown; approved: unknown }>>`
      SELECT currency,
        to_char(("issueDate" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM') AS month,
        SUM(total) AS quoted,
        COALESCE(SUM(total) FILTER (WHERE status IN (${wonStatuses})), 0) AS approved
      FROM "Quote"
      WHERE "issueDate" >= ${utcText(windowStart)}::timestamp
      GROUP BY currency, month`,
    prisma.$queryRaw<Array<Record<keyof CustomerQuoteGroup, unknown>>>`
      SELECT q."customerId" AS "customerId", c.name, c.company, q.currency,
        SUM(q.total) AS value,
        COUNT(*)::int AS count
      FROM "Quote" q
      JOIN "Customer" c ON c.id = q."customerId"
      GROUP BY q."customerId", c.name, c.company, q.currency`,
    prisma.trip.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.tripAssignment.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.$queryRaw<Array<{ vehicles: unknown; drivers: unknown; officers: unknown }>>`
      SELECT COUNT(DISTINCT "vehicleId")::int AS vehicles,
        COUNT(DISTINCT "driverId")::int AS drivers,
        COUNT(DISTINCT "officerId")::int AS officers
      FROM "TripAssignment"
      WHERE status IN (${activeStatuses})`,
    prisma.vehicle.count(),
    prisma.driver.count({ where: { retiredAt: null } }),
    prisma.officer.count({ where: { retiredAt: null } }),
    listDriverLicenses(),
  ]);

  return {
    invoiceStatuses: statusGroups(invoiceStatuses),
    invoiceGroups: invoiceGroups.map<InvoiceCurrencyGroup>((r) => ({
      currency: String(r.currency),
      count: num(r.count),
      billed: num(r.billed),
      collected: num(r.collected),
      outstanding: num(r.outstanding),
      overdue: num(r.overdue),
    })),
    invoiceMonths: invoiceMonths.map((r) => ({
      currency: r.currency,
      month: r.month,
      billed: num(r.billed),
      collected: num(r.collected),
    })),
    agingRows: agingRows.map((r) => ({ currency: r.currency, bucket: r.bucket, balance: num(r.balance) })),
    invoiceCustomers: invoiceCustomers.map<CustomerBalanceGroup>((r) => ({
      customerId: num(r.customerId),
      name: String(r.name),
      company: r.company === null ? null : String(r.company),
      currency: String(r.currency),
      balance: num(r.balance),
      overdue: num(r.overdue),
    })),
    quoteStatuses: statusGroups(quoteStatuses),
    quoteGroups: quoteGroups.map<QuoteCurrencyGroup>((r) => ({
      currency: String(r.currency),
      count: num(r.count),
      quoted: num(r.quoted),
      approved: num(r.approved),
    })),
    quoteMonths: quoteMonths.map((r) => ({
      currency: r.currency,
      month: r.month,
      quoted: num(r.quoted),
      approved: num(r.approved),
    })),
    quoteCustomers: quoteCustomers.map<CustomerQuoteGroup>((r) => ({
      customerId: num(r.customerId),
      name: String(r.name),
      company: r.company === null ? null : String(r.company),
      currency: String(r.currency),
      value: num(r.value),
      count: num(r.count),
    })),
    tripStatuses: statusGroups(tripStatuses),
    assignmentStatuses: statusGroups(assignmentStatuses),
    busy: {
      vehicles: num(busyRows[0]?.vehicles),
      drivers: num(busyRows[0]?.drivers),
      officers: num(busyRows[0]?.officers),
    },
    vehicleCount,
    driverCount,
    officerCount,
    licenses,
  };
}

type ReportInputs = Awaited<ReturnType<typeof loadReportInputs>>;

// ─── Sections ───────────────────────────────────────────────────────────────────

/** Counts come from every invoice; money only from those with a rate into the report currency. */
function buildFinance(
  inputs: ReportInputs,
  currency: string,
  rates: RateTable | null,
  months: MonthBucket[],
): { finance: ReportData['finance']; skipped: InvoiceCurrencyGroup[] } {
  const groups = toCurrency(inputs.invoiceGroups, ['billed', 'collected', 'outstanding', 'overdue'], currency, rates);
  const sum = (key: 'billed' | 'collected' | 'outstanding' | 'overdue') =>
    round2(groups.converted.reduce((acc, g) => acc + g[key], 0));

  const monthRows = toCurrency(inputs.invoiceMonths, ['billed', 'collected'], currency, rates).converted;
  const monthlyRaw = sumMonthGroups(monthRows, ['billed', 'collected'], months);
  const monthly: FinanceMonthPoint[] = months.map((m, idx) => ({
    month: m.label,
    billed: monthlyRaw[idx].billed,
    collected: monthlyRaw[idx].collected,
  }));

  const aging = sumAgingGroups(toCurrency(inputs.agingRows, ['balance'], currency, rates).converted);

  const byCustomer = new Map<number, { name: string; balance: number; overdue: number }>();
  for (const g of toCurrency(inputs.invoiceCustomers, ['balance', 'overdue'], currency, rates).converted) {
    const entry = byCustomer.get(g.customerId) ?? { name: customerLabel(g), balance: 0, overdue: 0 };
    entry.balance = round2(entry.balance + g.balance);
    entry.overdue = round2(entry.overdue + g.overdue);
    byCustomer.set(g.customerId, entry);
  }
  const topCustomers = [...byCustomer.values()]
    .filter((c) => c.balance > 0)
    .sort((a, b) => b.balance - a.balance)
    .slice(0, 8);

  const statusCounts = tallyStatusCounts(inputs.invoiceStatuses, INVOICE_STATUSES);
  return {
    finance: {
      totalBilled: sum('billed'),
      totalCollected: sum('collected'),
      outstanding: sum('outstanding'),
      overdue: sum('overdue'),
      collectedThisMonth: monthly[monthly.length - 1]?.collected ?? 0,
      invoiceCount: inputs.invoiceStatuses.reduce((acc, g) => acc + g.count, 0),
      paidCount: statusCounts.Paid ?? 0,
      statusCounts,
      monthly,
      aging,
      topCustomers,
    },
    skipped: groups.skipped,
  };
}

/** Counts come from every quote; money only from those with a rate into the report currency. */
function buildSales(
  inputs: ReportInputs,
  currency: string,
  rates: RateTable | null,
  months: MonthBucket[],
): { sales: ReportData['sales']; skipped: QuoteCurrencyGroup[] } {
  const groups = toCurrency(inputs.quoteGroups, ['quoted', 'approved'], currency, rates);
  const totalQuoted = round2(groups.converted.reduce((acc, g) => acc + g.quoted, 0));
  const approvedValue = round2(groups.converted.reduce((acc, g) => acc + g.approved, 0));

  const statusCounts = tallyStatusCounts(inputs.quoteStatuses, QUOTE_STATUSES);
  const winLoss = computeConversion(statusCounts);

  const monthRows = toCurrency(inputs.quoteMonths, ['quoted', 'approved'], currency, rates).converted;
  const monthlyRaw = sumMonthGroups(monthRows, ['quoted', 'approved'], months);
  const monthly: SalesMonthPoint[] = months.map((m, idx) => ({
    month: m.label,
    quoted: monthlyRaw[idx].quoted,
    approved: monthlyRaw[idx].approved,
  }));

  // Keyed by the displayed name, as before, so two accounts under one company merge.
  const byCustomer = new Map<string, { value: number; count: number }>();
  for (const g of toCurrency(inputs.quoteCustomers, ['value'], currency, rates).converted) {
    const name = customerLabel(g);
    const entry = byCustomer.get(name) ?? { value: 0, count: 0 };
    entry.value = round2(entry.value + g.value);
    entry.count += g.count;
    byCustomer.set(name, entry);
  }
  const topCustomers = [...byCustomer.entries()]
    .map(([name, v]) => ({ name, value: v.value, count: v.count }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  return {
    sales: {
      totalQuoted,
      approvedValue,
      conversionRate: winLoss.rate,
      quoteCount: inputs.quoteStatuses.reduce((acc, g) => acc + g.count, 0),
      statusCounts,
      monthly,
      winLoss,
      topCustomers,
    },
    skipped: groups.skipped,
  };
}

function buildOperations(inputs: ReportInputs): ReportData['operations'] {
  const fleet = utilization(inputs.vehicleCount, inputs.busy.vehicles);
  const drivers = utilization(inputs.driverCount, inputs.busy.drivers);
  const officers = utilization(inputs.officerCount, inputs.busy.officers);
  const totalResources = fleet.total + drivers.total + officers.total;
  const busyResources = fleet.busy + drivers.busy + officers.busy;
  const utilizationPct = totalResources === 0 ? 0 : Math.round((busyResources / totalResources) * 100);

  const tripStatusCounts = tallyStatusCounts(inputs.tripStatuses, TRIP_STATUSES);
  return {
    tripStatusCounts,
    assignmentStatusCounts: tallyStatusCounts(inputs.assignmentStatuses, [
      ...ACTIVE_ASSIGNMENT_STATUSES,
      'Completed',
      'Cancelled',
    ]),
    activeTrips: tripStatusCounts.Active ?? 0,
    totalTrips: inputs.tripStatuses.reduce((acc, g) => acc + g.count, 0),
    fleet,
    drivers,
    officers,
    utilizationPct,
  };
}

function buildCompliance(inputs: ReportInputs): ReportData['compliance'] {
  const upcoming = inputs.licenses
    .slice()
    .sort((a, b) => a.daysRemaining - b.daysRemaining)
    .slice(0, 10)
    .map((l) => ({
      name: l.driverName,
      licenseNumber: l.licenseNumber,
      category: l.category,
      expiry: l.expiryDate,
      daysRemaining: l.daysRemaining,
      status: l.status,
    }));
  return { license: computeLicenseStats(inputs.licenses), upcoming };
}

async function buildReport(currency: string, rates: (RateTable & { stale?: boolean }) | null): Promise<ReportData> {
  const now = new Date();
  const months = lastNMonths(MONTHS_SHOWN, now);
  const windowStart = new Date(now.getFullYear(), now.getMonth() - (MONTHS_SHOWN - 1), 1);
  const inputs = await loadReportInputs(now, windowStart);

  const { finance, skipped: skippedInvoices } = buildFinance(inputs, currency, rates, months);
  const { sales, skipped: skippedQuotes } = buildSales(inputs, currency, rates, months);

  const sourceCurrencies = [
    ...new Set([...inputs.invoiceGroups, ...inputs.quoteGroups].map((g) => g.currency)),
  ]
    .filter((c) => c !== currency)
    .sort();
  const conversions = sourceCurrencies.flatMap((from) => {
    const rate = crossRate(rates, from, currency);
    return rate === null ? [] : [{ from, to: currency, rate }];
  });

  return {
    generatedAt: now.toISOString(),
    currency,
    fx: {
      conversions,
      asOf: conversions.length > 0 && rates ? rates.asOf : null,
      stale: conversions.length > 0 && Boolean(rates?.stale),
      skipped: {
        invoices: skippedInvoices.reduce((acc, g) => acc + g.count, 0),
        quotes: skippedQuotes.reduce((acc, g) => acc + g.count, 0),
        currencies: [...new Set([...skippedInvoices, ...skippedQuotes].map((g) => g.currency))].sort(),
      },
    },
    finance,
    sales,
    operations: buildOperations(inputs),
    compliance: buildCompliance(inputs),
  };
}

// ─── Cache ──────────────────────────────────────────────────────────────────────

const reportCache = new Map<string, { expiresAt: number; data: ReportData }>();

function cacheKey(currency: string, rates: (RateTable & { stale?: boolean }) | null): string {
  // The rate table only changes when the provider publishes a new one.
  return rates ? `${currency}|${rates.base}|${rates.asOf}|${rates.stale ? 'stale' : 'fresh'}` : `${currency}|no-rates`;
}

/** One build per request even if several callers ask (e.g. page and metadata). */
const buildReportOnce = cache(buildReport);

/**
 * Forget every cached report so the next request recomputes. Nothing calls
 * this yet: the sums are at most REPORT_TTL_MS behind a new invoice, quote or
 * assignment. Call it from a write path if a report must reflect it at once.
 */
export function invalidateReportCache(): void {
  reportCache.clear();
}

/**
 * Everything on the reports page, with money in `currency`. Invoices and quotes
 * carry their own currency, so each currency's sums are converted with `rates`
 * before anything is added together; `fx` records what was applied and what
 * had to be left out. The database does the summing; a finished report is
 * reused for a few minutes.
 */
export async function getReportData(params: {
  /** Kept for callers; the report covers the whole organisation, as it always has. */
  userId: number;
  currency: string;
  rates: (RateTable & { stale?: boolean }) | null;
}): Promise<ReportData> {
  const key = cacheKey(params.currency, params.rates);
  const hit = reportCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.data;

  const data = await buildReportOnce(params.currency, params.rates);
  reportCache.set(key, { expiresAt: Date.now() + REPORT_TTL_MS, data });
  return data;
}
