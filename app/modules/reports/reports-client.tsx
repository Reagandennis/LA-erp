'use client';

import { describeRate, RATES_SOURCE } from '@/lib/exchange-rates';
import { APP_LOCALE } from '@/lib/locale';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

import type { ReportData } from '@/lib/reports';

import { BarList, ColumnChart, DonutChart, type Slice, Sparkline, StackedMeter, TrendChart, viz } from './charts';
import { REPORT_CURRENCIES, type ReportCurrency } from './report-currency';

interface ReportsClientProps {
  data: ReportData;
  currency: string;
}

type Tab = 'Overview' | 'Finance' | 'Sales' | 'Operations' | 'Compliance';
const TABS: Tab[] = ['Overview', 'Finance', 'Sales', 'Operations', 'Compliance'];

/**
 * Status → colour. Workflow stages take one blue ramp (light → dark as the
 * record progresses); terminal states take the reserved status colours; dead
 * ends are neutral. Colour follows the status name, never the slice's rank, so
 * a status keeps its colour whichever tab or filter it appears under. Key order
 * is the record's lifecycle, which is also the order charts list them in.
 */
const INVOICE_COLORS: Record<string, string> = {
  Draft: viz.ordinal5[0],
  'Pending Approval': viz.ordinal5[1],
  Approved: viz.ordinal5[2],
  Sent: viz.ordinal5[3],
  Partial: viz.status.warning,
  Paid: viz.status.good,
  Declined: viz.status.critical,
  Void: viz.neutral,
};

// A quote is approved internally, then sent to the client; Sent is the furthest
// a quote gets, so it takes "good" and Approved is the last blue stage.
const QUOTE_COLORS: Record<string, string> = {
  Draft: viz.stage[0],
  Submitted: viz.stage[1],
  Approved: viz.stage[2],
  Sent: viz.status.good,
  Declined: viz.status.critical,
  Expired: viz.neutral,
};

const TRIP_COLORS: Record<string, string> = {
  Draft: viz.stage[0],
  Planned: viz.stage[1],
  Active: viz.stage[2],
  Completed: viz.status.good,
  Cancelled: viz.status.critical,
};

const ASSIGNMENT_COLORS: Record<string, string> = {
  Planned: viz.stage[0],
  Confirmed: viz.stage[1],
  Active: viz.stage[2],
  Completed: viz.status.good,
  Cancelled: viz.status.critical,
};

const LICENSE_COLORS: Record<string, string> = {
  Valid: viz.status.good,
  'Expiring Soon': viz.status.warning,
  Expired: viz.status.critical,
};

const LICENSE_BADGE: Record<string, string> = {
  Valid: 'bg-emerald-50 text-emerald-700',
  'Expiring Soon': 'bg-amber-50 text-amber-700',
  Expired: 'bg-rose-50 text-rose-700',
};

function money(value: number, currency: string) {
  return value.toLocaleString(APP_LOCALE, { style: 'currency', currency, maximumFractionDigits: 0 });
}

function compactMoney(value: number, currency: string, digits = 1) {
  return value.toLocaleString(APP_LOCALE, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: digits });
}

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(APP_LOCALE, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Non-empty statuses in lifecycle order (the colour map's key order), unknown ones last. */
function statusSlices(counts: Record<string, number>, colors: Record<string, string>): Slice[] {
  const order = Object.keys(colors);
  const rank = (label: string) => (order.includes(label) ? order.indexOf(label) : order.length);
  return Object.entries(counts)
    .filter(([, v]) => v > 0)
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([label, value]) => ({ label, value, color: colors[label] ?? viz.neutral }));
}

/**
 * Latest month against the one before. The latest month is still running, so
 * the delta names both months and says the current one is to date, rather
 * than passing a part month off as a whole one.
 */
function monthDelta<T extends { month: string }>(points: T[], pick: (p: T) => number): Delta | undefined {
  if (points.length < 2) return undefined;
  const last = pick(points[points.length - 1]!);
  const prev = pick(points[points.length - 2]!);
  const current = points[points.length - 1]!.month.split(' ')[0];
  const previous = points[points.length - 2]!.month.split(' ')[0];
  if (prev === 0 && last === 0) return undefined;
  if (prev === 0) return { label: `new in ${current}`, direction: last > 0 ? 'up' : 'flat' };
  const pct = Math.round(((last - prev) / Math.abs(prev)) * 100);
  return {
    label: `${pct > 0 ? '+' : ''}${pct}% vs ${previous}`,
    note: `${current} to date`,
    direction: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat',
  };
}

/** Running total, so a tile's sparkline ends at the figure the tile shows. */
function cumulative(values: number[]): number[] {
  return values.reduce<number[]>((acc, v) => [...acc, (acc[acc.length - 1] ?? 0) + v], []);
}

function exportCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const escape = (cell: string | number) => {
    const s = String(cell);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers, ...rows].map((r) => r.map(escape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const CURRENCY_NAMES: Record<string, string> = { KES: 'Kenyan shillings', USD: 'US dollars' };

export default function ReportsClient({ data, currency }: ReportsClientProps) {
  const [tab, setTab] = useState<Tab>('Overview');
  const [months, setMonths] = useState<3 | 6 | 12>(6);
  const router = useRouter();
  const pathname = usePathname();
  const [switching, startSwitch] = useTransition();
  const showsMoney = tab !== 'Operations' && tab !== 'Compliance';

  // The currency is converted on the server, so switching it re-requests the page.
  const switchCurrency = (next: ReportCurrency) =>
    startSwitch(() => router.replace(`${pathname}?currency=${next}`, { scroll: false }));

  const fin = data.finance;
  const sales = data.sales;
  const ops = data.operations;
  const comp = data.compliance;

  const financeMonthly = useMemo(() => fin.monthly.slice(-months), [fin.monthly, months]);
  const salesMonthly = useMemo(() => sales.monthly.slice(-months), [sales.monthly, months]);

  const exportCurrentTab = () => {
    if (tab === 'Finance' || tab === 'Overview') {
      exportCsv(
        'reports-finance-monthly.csv',
        ['Month', `Billed (${currency})`, `Collected (${currency})`],
        financeMonthly.map((m) => [m.month, m.billed, m.collected]),
      );
    } else if (tab === 'Sales') {
      exportCsv(
        'reports-sales-monthly.csv',
        ['Month', `Quoted (${currency})`, `Approved (${currency})`],
        salesMonthly.map((m) => [m.month, m.quoted, m.approved]),
      );
    } else if (tab === 'Operations') {
      exportCsv(
        'reports-operations-resources.csv',
        ['Resource', 'Total', 'Busy', 'Idle'],
        [
          ['Vehicles', ops.fleet.total, ops.fleet.busy, ops.fleet.idle],
          ['Drivers', ops.drivers.total, ops.drivers.busy, ops.drivers.idle],
          ['Officers', ops.officers.total, ops.officers.busy, ops.officers.idle],
        ],
      );
    } else {
      exportCsv(
        'reports-compliance-expiries.csv',
        ['Driver', 'Licence', 'Category', 'Expiry', 'Days remaining', 'Status'],
        comp.upcoming.map((l) => [l.name, l.licenseNumber, l.category, formatDate(l.expiry), l.daysRemaining, l.status]),
      );
    }
  };

  return (
    <div className="min-h-screen bg-gray-50/50 p-4 sm:p-6 lg:p-10">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-primary sm:text-3xl">Reports</h1>
            <p className="mt-1 text-sm text-gray-500">Live figures from invoices, quotes, trips, fleet and licences.</p>
            {showsMoney && <FxNote data={data} />}
          </div>
          <button
            type="button"
            onClick={exportCurrentTab}
            className="inline-flex items-center gap-2 self-start rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 shadow-sm transition-colors hover:border-primary/30 hover:text-primary lg:self-auto"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
            </svg>
            Export CSV
          </button>
        </header>

        {/* Filter row: tabs scope the sections, the range scopes every chart below. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex max-w-full items-center gap-1 overflow-x-auto rounded-xl border border-gray-100 bg-white p-1 scrollbar-hide">
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${
                  tab === t ? 'bg-primary text-white' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          {showsMoney && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Segmented
                label="Currency"
                options={REPORT_CURRENCIES.map((c) => ({ value: c, label: c }))}
                value={currency}
                onChange={switchCurrency}
              />
              <Segmented
                label="Range"
                options={([3, 6, 12] as const).map((m) => ({ value: m, label: `${m} months` }))}
                value={months}
                onChange={setMonths}
              />
            </div>
          )}
        </div>

        <div className={`transition-opacity ${switching ? 'opacity-50' : ''}`} aria-busy={switching}>
          {tab === 'Overview' && <OverviewTab data={data} currency={currency} financeMonthly={financeMonthly} />}
          {tab === 'Finance' && <FinanceTab fin={fin} currency={currency} monthly={financeMonthly} />}
          {tab === 'Sales' && <SalesTab sales={sales} currency={currency} monthly={salesMonthly} />}
          {tab === 'Operations' && <OperationsTab ops={ops} />}
          {tab === 'Compliance' && <ComplianceTab comp={comp} />}
        </div>

        <p className="text-center text-xs text-gray-400">
          Generated {new Date(data.generatedAt).toLocaleString(APP_LOCALE)}
        </p>
      </div>
    </div>
  );
}

/* ---------- Overview ---------- */

function OverviewTab({
  data,
  currency,
  financeMonthly,
}: {
  data: ReportData;
  currency: string;
  financeMonthly: ReportData['finance']['monthly'];
}) {
  const { finance: fin, sales, operations: ops, compliance: comp } = data;
  const fmt = (v: number) => compactMoney(v, currency);
  const winLoss: Slice[] = [
    { label: 'Won', value: sales.winLoss.won, color: viz.status.good },
    { label: 'Lost', value: sales.winLoss.lost, color: viz.status.critical },
    { label: 'Open', value: sales.winLoss.open, color: viz.neutral },
  ];
  const trips = statusSlices(ops.tripStatusCounts, TRIP_COLORS);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatTile
          label="Outstanding receivables"
          value={money(fin.outstanding, currency)}
          compact={compactMoney(fin.outstanding, currency, 2)}
          tone={fin.overdue > 0 ? 'critical' : 'default'}
          note={fin.overdue > 0 ? `${money(fin.overdue, currency)} overdue` : 'nothing overdue'}
          spark={cumulative(fin.monthly.map((m) => m.billed - m.collected))}
        />
        <StatTile
          label="Collected"
          value={money(fin.totalCollected, currency)}
          compact={compactMoney(fin.totalCollected, currency, 2)}
          delta={monthDelta(fin.monthly, (m) => m.collected)}
          upIsGood
          spark={fin.monthly.map((m) => m.collected)}
        />
        <StatTile
          label="Quote conversion"
          value={`${sales.conversionRate}%`}
          note={`${sales.winLoss.won} won · ${sales.winLoss.lost} lost`}
          meter={sales.conversionRate / 100}
        />
        <StatTile
          label="Fleet utilisation"
          value={`${ops.utilizationPct}%`}
          note={`${ops.fleet.busy} of ${ops.fleet.total} vehicles in use`}
          meter={ops.fleet.total > 0 ? ops.fleet.busy / ops.fleet.total : 0}
        />
      </div>

      <ChartCard
        title="Billed vs collected"
        subtitle="By invoice issue month"
        table={{
          headers: ['Month', 'Billed', 'Collected'],
          align: ['left', 'right', 'right'],
          rows: financeMonthly.map((m) => [m.month, money(m.billed, currency), money(m.collected, currency)]),
        }}
      >
        <TrendChart
          data={financeMonthly.map((m) => ({ label: m.month, values: [m.billed, m.collected] }))}
          series={[
            { name: 'Billed', color: viz.series[0] },
            { name: 'Collected', color: viz.series[1] },
          ]}
          formatValue={fmt}
          formatTick={fmt}
        />
      </ChartCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="Quote win / loss" table={sliceTable(winLoss, 'Outcome', 'Quotes')}>
          <DonutChart centerLabel="quotes" centerValue={`${sales.quoteCount}`} data={winLoss} />
        </ChartCard>
        <ChartCard title="Trips by status" table={sliceTable(trips, 'Status', 'Trips')}>
          <DonutChart centerLabel="trips" centerValue={`${ops.totalTrips}`} data={trips} />
        </ChartCard>
      </div>

      {(comp.license.expired > 0 || comp.license.expiringSoon > 0) && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900">
          <span className="font-semibold">Licence attention</span>
          {comp.license.expired > 0 && <span>{comp.license.expired} expired</span>}
          {comp.license.expiringSoon > 0 && <span>{comp.license.expiringSoon} expiring soon</span>}
          <Link href="/modules/drivers-license-expiry" className="ml-auto font-semibold text-primary hover:text-primary/80">
            Open licences →
          </Link>
        </div>
      )}
    </div>
  );
}

/* ---------- Finance ---------- */

function FinanceTab({
  fin,
  currency,
  monthly,
}: {
  fin: ReportData['finance'];
  currency: string;
  monthly: ReportData['finance']['monthly'];
}) {
  const fmt = (v: number) => compactMoney(v, currency);
  const aging: Slice[] = [
    { label: 'Current', value: fin.aging.current, color: viz.ordinal5[0] },
    { label: '1–30 days', value: fin.aging.d1_30, color: viz.ordinal5[1] },
    { label: '31–60 days', value: fin.aging.d31_60, color: viz.ordinal5[2] },
    { label: '61–90 days', value: fin.aging.d61_90, color: viz.ordinal5[3] },
    { label: '90+ days', value: fin.aging.d90plus, color: viz.ordinal5[4] },
  ];
  const statuses = statusSlices(fin.statusCounts, INVOICE_COLORS);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatTile
          label="Total billed"
          value={money(fin.totalBilled, currency)}
          compact={compactMoney(fin.totalBilled, currency, 2)}
          delta={monthDelta(monthly, (m) => m.billed)}
          upIsGood
        />
        <StatTile
          label="Collected"
          value={money(fin.totalCollected, currency)}
          compact={compactMoney(fin.totalCollected, currency, 2)}
          tone="good"
          delta={monthDelta(monthly, (m) => m.collected)}
          upIsGood
        />
        <StatTile
          label="Outstanding"
          value={money(fin.outstanding, currency)}
          compact={compactMoney(fin.outstanding, currency, 2)}
          note={`${fin.invoiceCount} invoices`}
        />
        <StatTile
          label="Overdue"
          value={money(fin.overdue, currency)}
          compact={compactMoney(fin.overdue, currency, 2)}
          tone={fin.overdue > 0 ? 'critical' : 'default'}
        />
      </div>

      <ChartCard
        title="Billed vs collected"
        subtitle="By invoice issue month"
        table={{
          headers: ['Month', 'Billed', 'Collected'],
          align: ['left', 'right', 'right'],
          rows: monthly.map((m) => [m.month, money(m.billed, currency), money(m.collected, currency)]),
        }}
      >
        <ColumnChart
          data={monthly.map((m) => ({ label: m.month, values: [m.billed, m.collected] }))}
          series={[
            { name: 'Billed', color: viz.series[0] },
            { name: 'Collected', color: viz.series[1] },
          ]}
          formatValue={fmt}
          formatTick={fmt}
        />
      </ChartCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="Receivables aging" subtitle="Outstanding balance by age" table={sliceTable(aging, 'Age', 'Balance', (v) => money(v, currency))}>
          <StackedMeter segments={aging} formatValue={(v) => money(v, currency)} legend="list" />
        </ChartCard>
        <ChartCard title="Invoices by status" subtitle={`${fin.invoiceCount} invoices`} table={sliceTable(statuses, 'Status', 'Invoices')}>
          <BarList data={statuses} />
        </ChartCard>
      </div>

      <ChartCard title="Top clients by balance" action={{ href: '/modules/customers', label: 'Open clients →' }}>
        <SimpleTable
          headers={['Client', 'Open balance', 'Overdue']}
          align={['left', 'right', 'right']}
          rows={fin.topCustomers.map((c) => [
            c.name,
            money(c.balance, currency),
            c.overdue > 0 ? <span className="font-semibold text-rose-600">{money(c.overdue, currency)}</span> : '—',
          ])}
          empty="No outstanding balances."
        />
      </ChartCard>
    </div>
  );
}

/* ---------- Sales ---------- */

function SalesTab({
  sales,
  currency,
  monthly,
}: {
  sales: ReportData['sales'];
  currency: string;
  monthly: ReportData['sales']['monthly'];
}) {
  const fmt = (v: number) => compactMoney(v, currency);
  const statuses = statusSlices(sales.statusCounts, QUOTE_COLORS);
  const winLoss: Slice[] = [
    { label: 'Won', value: sales.winLoss.won, color: viz.status.good },
    { label: 'Lost', value: sales.winLoss.lost, color: viz.status.critical },
    { label: 'Open', value: sales.winLoss.open, color: viz.neutral },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatTile
          label="Total quoted"
          value={money(sales.totalQuoted, currency)}
          compact={compactMoney(sales.totalQuoted, currency, 2)}
          delta={monthDelta(monthly, (m) => m.quoted)}
          upIsGood
        />
        <StatTile
          label="Approved value"
          value={money(sales.approvedValue, currency)}
          compact={compactMoney(sales.approvedValue, currency, 2)}
          tone="good"
          delta={monthDelta(monthly, (m) => m.approved)}
          upIsGood
        />
        <StatTile label="Conversion" value={`${sales.conversionRate}%`} note={`${sales.winLoss.won} won of ${sales.winLoss.won + sales.winLoss.lost} decided`} />
        <StatTile label="Open quotes" value={`${sales.winLoss.open}`} note={`${sales.quoteCount} quotes in total`} />
      </div>

      <ChartCard
        title="Quoted vs approved"
        subtitle="By quote issue month"
        table={{
          headers: ['Month', 'Quoted', 'Approved'],
          align: ['left', 'right', 'right'],
          rows: monthly.map((m) => [m.month, money(m.quoted, currency), money(m.approved, currency)]),
        }}
      >
        <ColumnChart
          data={monthly.map((m) => ({ label: m.month, values: [m.quoted, m.approved] }))}
          series={[
            { name: 'Quoted', color: viz.series[0] },
            { name: 'Approved', color: viz.series[2] },
          ]}
          formatValue={fmt}
          formatTick={fmt}
        />
      </ChartCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="Quotes by status" subtitle={`${sales.quoteCount} quotes`} table={sliceTable(statuses, 'Status', 'Quotes')}>
          <BarList data={statuses} />
        </ChartCard>
        <ChartCard title="Win / loss" subtitle="Decided and open quotes" table={sliceTable(winLoss, 'Outcome', 'Quotes')}>
          <StackedMeter segments={winLoss} legend="list" />
        </ChartCard>
      </div>

      <ChartCard title="Top clients by quoted value" action={{ href: '/modules/quotes', label: 'Open quotes →' }}>
        <SimpleTable
          headers={['Client', 'Quoted value', 'Quotes']}
          align={['left', 'right', 'right']}
          rows={sales.topCustomers.map((c) => [c.name, money(c.value, currency), c.count])}
          empty="No quotes yet."
        />
      </ChartCard>
    </div>
  );
}

/* ---------- Operations ---------- */

function OperationsTab({ ops }: { ops: ReportData['operations'] }) {
  const trips = statusSlices(ops.tripStatusCounts, TRIP_COLORS);
  const assignments = statusSlices(ops.assignmentStatusCounts, ASSIGNMENT_COLORS);
  const resources = [
    ['Vehicles', ops.fleet],
    ['Drivers', ops.drivers],
    ['Officers', ops.officers],
  ] as const;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatTile label="Active trips" value={`${ops.activeTrips}`} note={`${ops.totalTrips} trips in total`} />
        {resources.map(([label, r]) => (
          <StatTile
            key={label}
            label={`${label} in use`}
            value={r.total === 0 ? '—' : `${r.busy} / ${r.total}`}
            note={r.total === 0 ? 'none registered' : `${Math.round((r.busy / r.total) * 100)}% busy`}
            meter={r.total > 0 ? r.busy / r.total : 0}
          />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="Trips by status" table={sliceTable(trips, 'Status', 'Trips')}>
          <DonutChart centerLabel="trips" centerValue={`${ops.totalTrips}`} data={trips} />
        </ChartCard>
        <ChartCard title="Assignments by status" table={sliceTable(assignments, 'Status', 'Assignments')}>
          <DonutChart
            centerLabel="assignments"
            centerValue={`${Object.values(ops.assignmentStatusCounts).reduce((a, b) => a + b, 0)}`}
            data={assignments}
          />
        </ChartCard>
      </div>

      <ChartCard
        title="Resource utilisation"
        subtitle="Busy vs idle"
        action={{ href: '/modules/task-assignment', label: 'Open assignments →' }}
        table={{
          headers: ['Resource', 'Busy', 'Idle', 'Total'],
          align: ['left', 'right', 'right', 'right'],
          rows: resources.map(([label, r]) => [label, r.busy, r.idle, r.total]),
        }}
      >
        <div className="space-y-5">
          {resources.map(([label, r]) => (
            <div key={label}>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-medium text-gray-700">{label}</span>
                <span className="text-gray-400">{r.total === 0 ? '—' : `${Math.round((r.busy / r.total) * 100)}% in use`}</span>
              </div>
              <StackedMeter
                segments={[
                  { label: 'Busy', value: r.busy, color: viz.series[0] },
                  { label: 'Idle', value: r.idle, color: viz.neutral },
                ]}
              />
            </div>
          ))}
        </div>
      </ChartCard>
    </div>
  );
}

/* ---------- Compliance ---------- */

function ComplianceTab({ comp }: { comp: ReportData['compliance'] }) {
  const licences: Slice[] = [
    { label: 'Valid', value: comp.license.valid, color: LICENSE_COLORS.Valid! },
    { label: 'Expiring Soon', value: comp.license.expiringSoon, color: LICENSE_COLORS['Expiring Soon']! },
    { label: 'Expired', value: comp.license.expired, color: LICENSE_COLORS.Expired! },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3 lg:gap-4">
        <StatTile label="Valid" value={`${comp.license.valid}`} tone="good" note={`of ${comp.license.total} licences`} />
        <StatTile label="Expiring soon" value={`${comp.license.expiringSoon}`} tone={comp.license.expiringSoon > 0 ? 'warning' : 'default'} />
        <StatTile label="Expired" value={`${comp.license.expired}`} tone={comp.license.expired > 0 ? 'critical' : 'default'} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="Licences by status" table={sliceTable(licences, 'Status', 'Licences')}>
          <DonutChart centerLabel="licences" centerValue={`${comp.license.total}`} data={licences} />
        </ChartCard>
        <ChartCard title="Soonest expiries" action={{ href: '/modules/drivers-license-expiry', label: 'Open licences →' }}>
          <SimpleTable
            headers={['Driver', 'Expiry', 'Status']}
            align={['left', 'left', 'left']}
            rows={comp.upcoming.map((l) => [
              <div key={l.licenseNumber}>
                <p className="font-medium text-gray-900">{l.name}</p>
                <p className="text-xs text-gray-400">
                  {l.licenseNumber} · {l.category}
                </p>
              </div>,
              <div key="exp">
                <p className="text-gray-700">{formatDate(l.expiry)}</p>
                <p className="text-xs text-gray-400">{l.daysRemaining < 0 ? `${Math.abs(l.daysRemaining)}d ago` : `in ${l.daysRemaining}d`}</p>
              </div>,
              <span
                key="badge"
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${LICENSE_BADGE[l.status] ?? 'bg-gray-100 text-gray-600'}`}
              >
                {l.status}
              </span>,
            ])}
            empty="No licences tracked yet."
          />
        </ChartCard>
      </div>
    </div>
  );
}

/* ---------- Shared primitives ---------- */

/** A labelled pill group for one filter: range, currency. */
function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T | string;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex items-center gap-2 text-xs text-gray-500" role="group" aria-label={label}>
      <span>{label}</span>
      <div className="flex items-center rounded-xl border border-gray-100 bg-white p-1">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={value === o.value}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              value === o.value ? 'bg-primary text-white' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Which currency the money is in, the rate it was converted at and when that
 * rate was published, plus anything left out for want of a rate.
 */
function FxNote({ data }: { data: ReportData }) {
  const { fx, currency } = data;
  const skipped = fx.skipped.invoices + fx.skipped.quotes;
  const records = [
    fx.skipped.invoices > 0 && `${fx.skipped.invoices} invoice${fx.skipped.invoices === 1 ? '' : 's'}`,
    fx.skipped.quotes > 0 && `${fx.skipped.quotes} quote${fx.skipped.quotes === 1 ? '' : 's'}`,
  ].filter(Boolean);

  return (
    <div className="mt-1.5 space-y-1 text-xs text-gray-400">
      <p>
        Amounts in {CURRENCY_NAMES[currency] ?? currency}
        {fx.conversions.length > 0 && fx.asOf && (
          <>
            {' '}· {fx.conversions.map((c) => describeRate(c.from, c.to, c.rate)).join(', ')} · rate of {formatDate(fx.asOf)},{' '}
            <a href={RATES_SOURCE.url} target="_blank" rel="noreferrer" className="underline decoration-gray-300 hover:text-gray-600">
              {RATES_SOURCE.name}
            </a>
          </>
        )}
        {fx.stale && <span className="text-amber-700"> · couldn&apos;t refresh, using the last saved rate</span>}
      </p>
      {skipped > 0 && (
        <p className="text-amber-700">
          {records.join(' and ')} in {fx.skipped.currencies.join(', ')} left out of the totals: no exchange rate is available yet.
        </p>
      )}
    </div>
  );
}

interface Delta {
  label: string;
  /** Muted qualifier after the delta, e.g. that the month is still running. */
  note?: string;
  direction: 'up' | 'down' | 'flat';
}

type Tone = 'default' | 'good' | 'warning' | 'critical';

const TONE_CLASS: Record<Tone, string> = {
  default: 'text-gray-900',
  good: 'text-emerald-700',
  warning: 'text-amber-700',
  critical: 'text-rose-700',
};

/**
 * Stat tile: label, value, an optional signed delta against last month (its
 * colour is direction × whether up is good), and either a sparkline or a
 * meter whose track is a lighter step of the same hue.
 */
function StatTile({
  label,
  value,
  tone = 'default',
  note,
  delta,
  upIsGood = true,
  spark,
  meter,
  compact,
}: {
  label: string;
  value: string;
  /** Shorter form ("KES 4.64M") shown when a long value would overflow a narrow tile. */
  compact?: string;
  tone?: Tone;
  note?: string;
  delta?: Delta;
  upIsGood?: boolean;
  spark?: number[];
  meter?: number;
}) {
  const deltaGood = delta && delta.direction !== 'flat' ? (delta.direction === 'up') === upIsGood : null;
  const deltaClass = deltaGood === null ? 'text-gray-500' : deltaGood ? 'text-emerald-700' : 'text-rose-700';
  const arrow = delta?.direction === 'up' ? '▲' : delta?.direction === 'down' ? '▼' : '—';

  return (
    <div className="@container rounded-2xl border border-gray-100 bg-white p-4 lg:p-5">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`mt-1.5 text-xl font-semibold lg:text-2xl ${TONE_CLASS[tone]}`} title={compact ? value : undefined}>
        {/* Short values always fit; long ones (shilling amounts) swap to the compact form below 12rem. */}
        {compact && value.length > 10 ? (
          <>
            <span className="@min-[12rem]:hidden">{compact}</span>
            <span className="hidden @min-[12rem]:inline">{value}</span>
          </>
        ) : (
          value
        )}
      </p>
      {delta ? (
        <p className={`mt-1 text-xs font-medium ${deltaClass}`}>
          <span aria-hidden="true" className="mr-1 text-[9px]">
            {arrow}
          </span>
          {delta.label}
          {delta.note && <span className="font-normal text-gray-400"> · {delta.note}</span>}
        </p>
      ) : note ? (
        <p className="mt-1 text-xs text-gray-400">{note}</p>
      ) : null}
      {spark && spark.some((v) => v !== 0) && (
        <div className="mt-3">
          <Sparkline values={spark} />
        </div>
      )}
      {meter !== undefined && (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full" style={{ backgroundColor: '#cde2fb' }}>
          <div className="h-full rounded-full" style={{ width: `${Math.round(Math.min(1, Math.max(0, meter)) * 100)}%`, backgroundColor: viz.series[0] }} />
        </div>
      )}
    </div>
  );
}

interface TableSpec {
  headers: string[];
  rows: (string | number)[][];
  align?: ('left' | 'right')[];
}

/** Table twin for a slice-based chart (donut, meter). */
function sliceTable(slices: Slice[], first: string, second: string, format: (v: number) => string = (v) => v.toLocaleString()): TableSpec {
  const total = slices.reduce((acc, s) => acc + s.value, 0);
  return {
    headers: [first, second, 'Share'],
    align: ['left', 'right', 'right'],
    rows: slices.filter((s) => s.value > 0).map((s) => [s.label, format(s.value), total > 0 ? `${Math.round((s.value / total) * 100)}%` : '—']),
  };
}

/**
 * Card around a chart. When a `table` is supplied the header grows a
 * chart / table switch, so every figure is readable without colour or hover.
 */
function ChartCard({
  title,
  subtitle,
  action,
  table,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: { href: string; label: string };
  table?: TableSpec;
  children: React.ReactNode;
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-5 lg:p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-gray-400">{subtitle}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {table && (
            <div className="flex items-center rounded-lg border border-gray-100 p-0.5" role="group" aria-label="View">
              {(['chart', 'table'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  aria-pressed={view === v}
                  className={`rounded-md px-2 py-0.5 text-[11px] font-semibold capitalize transition-colors ${
                    view === v ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          )}
          {action && (
            <Link href={action.href} className="text-xs font-semibold text-primary hover:text-primary/80">
              {action.label}
            </Link>
          )}
        </div>
      </div>
      {table && view === 'table' ? (
        <SimpleTable headers={table.headers} align={table.align ?? table.headers.map(() => 'left')} rows={table.rows} empty="No data for this range." />
      ) : (
        children
      )}
    </section>
  );
}

function SimpleTable({
  headers,
  rows,
  align,
  empty,
}: {
  headers: string[];
  rows: React.ReactNode[][];
  align: ('left' | 'right')[];
  empty: string;
}) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-400">{empty}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-gray-100">
            {headers.map((h, i) => (
              <th
                key={h}
                className={`px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-gray-400 ${align[i] === 'right' ? 'text-right' : ''}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {rows.map((row, ri) => (
            <tr key={ri} className="transition-colors hover:bg-gray-50/70">
              {row.map((cell, ci) => (
                <td key={ci} className={`px-3 py-3 text-sm text-gray-700 ${align[ci] === 'right' ? 'text-right tabular-nums' : ''}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

