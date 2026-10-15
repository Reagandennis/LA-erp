import 'server-only';

import { computeStats as computeLicenseStats, listDriverLicenses, type DriverLicenseStats } from './drivers';
import { crossRate, type RateTable } from './exchange-rates';
import { listInvoices, type InvoiceStatus, type InvoiceSummary } from './invoices';
import { listQuotesForUser, type QuoteStatus, type QuoteSummary } from './quotes';
import {
  ACTIVE_ASSIGNMENT_STATUSES,
  listAssignments,
  listDrivers,
  listOfficers,
  listVehicles,
  type AssignmentSummary,
} from './task-assignment';
import { listTripsForUser, type TripStatus, type TripSummary } from './trips';

const INVOICE_STATUSES: InvoiceStatus[] = ['Draft', 'Sent', 'Partial', 'Paid', 'Void'];
const QUOTE_STATUSES: QuoteStatus[] = ['Draft', 'Submitted', 'Approved', 'Declined', 'Sent', 'Expired'];
const TRIP_STATUSES: TripStatus[] = ['Draft', 'Planned', 'Active', 'Completed', 'Cancelled'];

// Quote outcomes for the conversion funnel.
const QUOTE_WON: QuoteStatus[] = ['Approved', 'Sent'];
const QUOTE_LOST: QuoteStatus[] = ['Declined', 'Expired'];

const DAY_MS = 24 * 60 * 60 * 1000;

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

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Re-express each record's money `fields` in `currency`. Records in a
 * currency with no rate come back in `skipped`, so the report leaves them out
 * of the sums and says so instead of adding shillings to dollars.
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

function monthKeyOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Bucket `items` into `months`, summing one or more numeric series per bucket.
 * `dateKey` extracts the date string used to place an item; `series` maps a label
 * to a value extractor. Returns one row per month with the summed series.
 */
export function bucketByMonth<T>(
  items: T[],
  dateKey: (item: T) => string | null | undefined,
  series: Record<string, (item: T) => number>,
  months: MonthBucket[],
): Record<string, number>[] {
  const seriesKeys = Object.keys(series);
  const index = new Map<string, Record<string, number>>();
  const rows = months.map((m) => {
    const row: Record<string, number> = {};
    for (const k of seriesKeys) row[k] = 0;
    index.set(m.key, row);
    return row;
  });
  for (const item of items) {
    const key = monthKeyOf(dateKey(item));
    if (!key) continue;
    const row = index.get(key);
    if (!row) continue;
    for (const k of seriesKeys) row[k] = round2(row[k] + series[k](item));
  }
  return rows;
}

/** Split outstanding invoice balances into aging buckets by days past due. */
export function computeAging(invoices: InvoiceSummary[], now: Date = new Date()): AgingBuckets {
  const buckets: AgingBuckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 };
  for (const inv of invoices) {
    if (inv.status === 'Void' || inv.balanceDue <= 0) continue;
    if (!inv.isOverdue) {
      buckets.current += inv.balanceDue;
      continue;
    }
    const due = new Date(inv.dueDate);
    const days = Number.isNaN(due.getTime()) ? 0 : Math.floor((now.getTime() - due.getTime()) / DAY_MS);
    if (days <= 30) buckets.d1_30 += inv.balanceDue;
    else if (days <= 60) buckets.d31_60 += inv.balanceDue;
    else if (days <= 90) buckets.d61_90 += inv.balanceDue;
    else buckets.d90plus += inv.balanceDue;
  }
  return {
    current: round2(buckets.current),
    d1_30: round2(buckets.d1_30),
    d31_60: round2(buckets.d31_60),
    d61_90: round2(buckets.d61_90),
    d90plus: round2(buckets.d90plus),
  };
}

/** Win/loss/open counts and conversion rate (won / decided) across quotes. */
export function computeConversion(quotes: QuoteSummary[]): ConversionResult {
  let won = 0;
  let lost = 0;
  let open = 0;
  for (const q of quotes) {
    if (QUOTE_WON.includes(q.status)) won += 1;
    else if (QUOTE_LOST.includes(q.status)) lost += 1;
    else open += 1;
  }
  const decided = won + lost;
  const rate = decided === 0 ? 0 : Math.round((won / decided) * 100);
  return { won, lost, open, rate };
}

/** Count items per status, seeded with every known status at 0. */
export function tallyByStatus<T extends { status: string }>(
  items: T[],
  statuses: readonly string[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const s of statuses) counts[s] = 0;
  for (const item of items) {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
  }
  return counts;
}

function utilization(total: number, busyIds: Set<number>): ResourceUtilization {
  const busy = busyIds.size;
  return { total, busy, idle: Math.max(0, total - busy) };
}

/** Counts come from every invoice; money only from those already in the report currency. */
function buildFinance(invoices: InvoiceSummary[], inCurrency: InvoiceSummary[], months: MonthBucket[]): ReportData['finance'] {
  const live = inCurrency.filter((i) => i.status !== 'Void');
  const totalBilled = round2(live.reduce((acc, i) => acc + i.total, 0));
  const totalCollected = round2(live.reduce((acc, i) => acc + i.amountPaid, 0));
  const outstanding = round2(live.reduce((acc, i) => acc + i.balanceDue, 0));
  const overdue = round2(live.filter((i) => i.isOverdue).reduce((acc, i) => acc + i.balanceDue, 0));

  const monthlyRaw = bucketByMonth(
    live,
    (i) => i.issueDate,
    { billed: (i) => i.total, collected: (i) => i.amountPaid },
    months,
  );
  const monthly: FinanceMonthPoint[] = months.map((m, idx) => ({
    month: m.label,
    billed: monthlyRaw[idx].billed,
    collected: monthlyRaw[idx].collected,
  }));

  const byCustomer = new Map<number, { name: string; balance: number; overdue: number }>();
  for (const i of live) {
    if (i.balanceDue <= 0) continue;
    const entry = byCustomer.get(i.customer.id) ?? { name: i.customer.company || i.customer.name, balance: 0, overdue: 0 };
    entry.balance = round2(entry.balance + i.balanceDue);
    if (i.isOverdue) entry.overdue = round2(entry.overdue + i.balanceDue);
    byCustomer.set(i.customer.id, entry);
  }
  const topCustomers = [...byCustomer.values()].sort((a, b) => b.balance - a.balance).slice(0, 8);

  return {
    totalBilled,
    totalCollected,
    outstanding,
    overdue,
    collectedThisMonth: monthly[monthly.length - 1]?.collected ?? 0,
    invoiceCount: invoices.length,
    paidCount: invoices.filter((i) => i.status === 'Paid').length,
    statusCounts: tallyByStatus(invoices, INVOICE_STATUSES),
    monthly,
    aging: computeAging(inCurrency),
    topCustomers,
  };
}

/** Counts come from every quote; money only from those already in the report currency. */
function buildSales(quotes: QuoteSummary[], inCurrency: QuoteSummary[], months: MonthBucket[]): ReportData['sales'] {
  const totalQuoted = round2(inCurrency.reduce((acc, q) => acc + q.total, 0));
  const approvedValue = round2(
    inCurrency.filter((q) => QUOTE_WON.includes(q.status)).reduce((acc, q) => acc + q.total, 0),
  );
  const winLoss = computeConversion(quotes);

  const monthlyRaw = bucketByMonth(
    inCurrency,
    (q) => q.issueDate,
    {
      quoted: (q) => q.total,
      approved: (q) => (QUOTE_WON.includes(q.status) ? q.total : 0),
    },
    months,
  );
  const monthly: SalesMonthPoint[] = months.map((m, idx) => ({
    month: m.label,
    quoted: monthlyRaw[idx].quoted,
    approved: monthlyRaw[idx].approved,
  }));

  const byCustomer = new Map<string, { value: number; count: number }>();
  for (const q of inCurrency) {
    const name = q.customer.company || q.customer.name;
    const entry = byCustomer.get(name) ?? { value: 0, count: 0 };
    entry.value = round2(entry.value + q.total);
    entry.count += 1;
    byCustomer.set(name, entry);
  }
  const topCustomers = [...byCustomer.entries()]
    .map(([name, v]) => ({ name, value: v.value, count: v.count }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  return {
    totalQuoted,
    approvedValue,
    conversionRate: winLoss.rate,
    quoteCount: quotes.length,
    statusCounts: tallyByStatus(quotes, QUOTE_STATUSES),
    monthly,
    winLoss,
    topCustomers,
  };
}

function buildOperations(
  trips: TripSummary[],
  assignments: AssignmentSummary[],
  vehicleCount: number,
  driverCount: number,
  officerCount: number,
): ReportData['operations'] {
  const activeSet = new Set<string>(ACTIVE_ASSIGNMENT_STATUSES);
  const busyVehicles = new Set<number>();
  const busyDrivers = new Set<number>();
  const busyOfficers = new Set<number>();
  for (const a of assignments) {
    if (!activeSet.has(a.status)) continue;
    if (a.vehicle) busyVehicles.add(a.vehicle.id);
    if (a.driver) busyDrivers.add(a.driver.id);
    if (a.officer) busyOfficers.add(a.officer.id);
  }

  const fleet = utilization(vehicleCount, busyVehicles);
  const drivers = utilization(driverCount, busyDrivers);
  const officers = utilization(officerCount, busyOfficers);
  const totalResources = fleet.total + drivers.total + officers.total;
  const busyResources = fleet.busy + drivers.busy + officers.busy;
  const utilizationPct = totalResources === 0 ? 0 : Math.round((busyResources / totalResources) * 100);

  return {
    tripStatusCounts: tallyByStatus(trips, TRIP_STATUSES),
    assignmentStatusCounts: tallyByStatus(assignments, [...ACTIVE_ASSIGNMENT_STATUSES, 'Completed', 'Cancelled']),
    activeTrips: trips.filter((t) => t.status === 'Active').length,
    totalTrips: trips.length,
    fleet,
    drivers,
    officers,
    utilizationPct,
  };
}

/**
 * Everything on the reports page, with money in `currency`. Invoices and quotes
 * carry their own currency, so each is converted with `rates` before anything
 * is summed; `fx` records what was applied and what had to be left out.
 */
export async function getReportData(params: {
  userId: number;
  currency: string;
  rates: (RateTable & { stale?: boolean }) | null;
}): Promise<ReportData> {
  const { userId, currency, rates } = params;
  const months = lastNMonths(12);

  const [invoices, quotes, trips, assignments, vehicles, drivers, officers, licenses] =
    await Promise.all([
      listInvoices(),
      listQuotesForUser({ userId, isAdmin: true }),
      listTripsForUser({ userId, isAdmin: true }),
      listAssignments(),
      listVehicles(),
      listDrivers(),
      listOfficers(),
      listDriverLicenses(),
    ]);

  const upcoming = licenses
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

  const inv = toCurrency(invoices, ['total', 'amountPaid', 'balanceDue'], currency, rates);
  const quo = toCurrency(quotes, ['total'], currency, rates);

  const sourceCurrencies = [...new Set([...invoices, ...quotes].map((r) => r.currency))].filter((c) => c !== currency);
  const conversions = sourceCurrencies.flatMap((from) => {
    const rate = crossRate(rates, from, currency);
    return rate === null ? [] : [{ from, to: currency, rate }];
  });

  return {
    generatedAt: new Date().toISOString(),
    currency,
    fx: {
      conversions,
      asOf: conversions.length > 0 && rates ? rates.asOf : null,
      stale: conversions.length > 0 && Boolean(rates?.stale),
      skipped: {
        invoices: inv.skipped.length,
        quotes: quo.skipped.length,
        currencies: [...new Set([...inv.skipped, ...quo.skipped].map((r) => r.currency))],
      },
    },
    finance: buildFinance(invoices, inv.converted, months),
    sales: buildSales(quotes, quo.converted, months),
    operations: buildOperations(trips, assignments, vehicles.length, drivers.length, officers.length),
    compliance: {
      license: computeLicenseStats(licenses),
      upcoming,
    },
  };
}
