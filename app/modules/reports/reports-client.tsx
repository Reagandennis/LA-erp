'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import type { ReportData } from '@/lib/reports';

import { BarChart, BRAND_BLUE, BRAND_YELLOW, DonutChart, LineChart, ProgressMeter, Sparkline } from './charts';

interface ReportsClientProps {
  data: ReportData;
  currency: string;
}

type Tab = 'Overview' | 'Finance' | 'Sales' | 'Operations' | 'Compliance';
const TABS: Tab[] = ['Overview', 'Finance', 'Sales', 'Operations', 'Compliance'];

const INVOICE_COLORS: Record<string, string> = {
  Draft: '#94a3b8',
  Sent: '#0ea5e9',
  Partial: '#f9b232',
  Paid: '#10b981',
  Void: '#cbd5e1',
};

const QUOTE_COLORS: Record<string, string> = {
  Draft: '#94a3b8',
  Submitted: '#0ea5e9',
  Approved: '#10b981',
  Declined: '#f43f5e',
  Sent: '#03458f',
  Expired: '#cbd5e1',
};

const TRIP_COLORS: Record<string, string> = {
  Draft: '#94a3b8',
  Planned: '#0ea5e9',
  Active: '#03458f',
  Completed: '#10b981',
  Cancelled: '#f43f5e',
};

const LICENSE_COLORS: Record<string, string> = {
  Valid: '#10b981',
  'Expiring Soon': '#f9b232',
  Expired: '#f43f5e',
};

const LICENSE_BADGE: Record<string, string> = {
  Valid: 'bg-emerald-50 text-emerald-700',
  'Expiring Soon': 'bg-amber-50 text-amber-700',
  Expired: 'bg-rose-50 text-rose-700',
};

function money(value: number, currency: string) {
  return value.toLocaleString(undefined, { style: 'currency', currency, maximumFractionDigits: 0 });
}

function compactMoney(value: number, currency: string) {
  return value.toLocaleString(undefined, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 });
}

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function statusEntries(counts: Record<string, number>, colors: Record<string, string>) {
  return Object.entries(counts)
    .filter(([, v]) => v > 0)
    .map(([label, value]) => ({ label, value, color: colors[label] ?? '#94a3b8' }));
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

export default function ReportsClient({ data, currency }: ReportsClientProps) {
  const [tab, setTab] = useState<Tab>('Overview');
  const [months, setMonths] = useState<6 | 12>(6);

  const fin = data.finance;
  const sales = data.sales;
  const ops = data.operations;
  const comp = data.compliance;

  const financeMonthly = useMemo(() => fin.monthly.slice(-months), [fin.monthly, months]);
  const salesMonthly = useMemo(() => sales.monthly.slice(-months), [sales.monthly, months]);

  const exportCurrentTab = () => {
    if (tab === 'Finance' || tab === 'Overview') {
      exportCsv(
        'reports-finance-top-customers.csv',
        ['Customer', 'Open balance', 'Overdue'],
        fin.topCustomers.map((c) => [c.name, c.balance, c.overdue]),
      );
    } else if (tab === 'Sales') {
      exportCsv(
        'reports-sales-top-customers.csv',
        ['Customer', 'Quoted value', 'Quotes'],
        sales.topCustomers.map((c) => [c.name, c.value, c.count]),
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
      <div className="mx-auto max-w-7xl space-y-6 lg:space-y-8">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-primary sm:text-3xl">Reports</h1>
            <p className="mt-1 text-sm text-gray-500">
              Live insights across finance, sales, operations, and compliance.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-xl bg-white p-1 shadow-sm ring-1 ring-gray-100">
              {([6, 12] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMonths(m)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    months === m ? 'bg-primary text-white' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {m} mo
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={exportCurrentTab}
              className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 shadow-sm transition-colors hover:border-primary/30 hover:text-primary"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
              </svg>
              Export CSV
            </button>
          </div>
        </header>

        {/* Tab bar */}
        <div className="flex items-center gap-1 overflow-x-auto rounded-2xl border border-gray-100 bg-white p-1.5 scrollbar-hide">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`whitespace-nowrap rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
                tab === t ? 'bg-primary text-white' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === 'Overview' && (
          <OverviewTab data={data} currency={currency} financeMonthly={financeMonthly} />
        )}
        {tab === 'Finance' && <FinanceTab fin={fin} currency={currency} monthly={financeMonthly} />}
        {tab === 'Sales' && <SalesTab sales={sales} currency={currency} monthly={salesMonthly} />}
        {tab === 'Operations' && <OperationsTab ops={ops} />}
        {tab === 'Compliance' && <ComplianceTab comp={comp} />}

        <p className="text-center text-xs text-gray-400">
          Generated {new Date(data.generatedAt).toLocaleString()} · figures drawn live from invoices, quotes, trips, fleet, and licences.
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
  const { finance: fin, sales, operations: ops } = data;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <KpiCard
          label="Outstanding AR"
          value={money(fin.outstanding, currency)}
          accent={fin.overdue > 0 ? 'text-rose-600' : 'text-primary'}
          spark={fin.monthly.map((m) => m.billed - m.collected)}
          sparkColor="#f43f5e"
        />
        <KpiCard label="Collected" value={money(fin.totalCollected, currency)} spark={fin.monthly.map((m) => m.collected)} />
        <KpiCard label="Quote conversion" value={`${sales.conversionRate}%`} spark={sales.monthly.map((m) => m.approved)} sparkColor={BRAND_YELLOW} />
        <KpiCard label="Fleet utilization" value={`${ops.utilizationPct}%`} spark={[ops.fleet.idle, ops.fleet.busy]} />
      </div>

      <SectionCard title="Collected revenue" subtitle="Cash collected by invoice issue month">
        <LineChart
          data={financeMonthly.map((m) => ({ label: m.month, value: m.collected }))}
          color={BRAND_BLUE}
          formatValue={(v) => compactMoney(v, currency)}
        />
      </SectionCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Quote win / loss">
          <DonutChart
            centerLabel="quotes"
            centerValue={`${sales.quoteCount}`}
            data={[
              { label: 'Won', value: sales.winLoss.won, color: '#10b981' },
              { label: 'Lost', value: sales.winLoss.lost, color: '#f43f5e' },
              { label: 'Open', value: sales.winLoss.open, color: '#94a3b8' },
            ]}
          />
        </SectionCard>
        <SectionCard title="Trips by status">
          <DonutChart
            centerLabel="trips"
            centerValue={`${ops.totalTrips}`}
            data={statusEntries(ops.tripStatusCounts, TRIP_COLORS)}
          />
        </SectionCard>
      </div>
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
  const aging = [
    { label: 'Current', value: fin.aging.current, color: '#10b981' },
    { label: '1–30d', value: fin.aging.d1_30, color: '#f9b232' },
    { label: '31–60d', value: fin.aging.d31_60, color: '#fb923c' },
    { label: '61–90d', value: fin.aging.d61_90, color: '#f97316' },
    { label: '90d+', value: fin.aging.d90plus, color: '#f43f5e' },
  ];
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <KpiCard label="Total billed" value={money(fin.totalBilled, currency)} />
        <KpiCard label="Collected" value={money(fin.totalCollected, currency)} accent="text-emerald-600" />
        <KpiCard label="Outstanding" value={money(fin.outstanding, currency)} accent="text-primary" />
        <KpiCard label="Overdue" value={money(fin.overdue, currency)} accent={fin.overdue > 0 ? 'text-rose-600' : 'text-gray-900'} />
      </div>

      <SectionCard title="Billed vs collected" subtitle="By invoice issue month">
        <BarChart
          data={monthly.map((m) => ({ label: m.month, values: [m.billed, m.collected] }))}
          series={[
            { name: 'Billed', color: BRAND_BLUE },
            { name: 'Collected', color: BRAND_YELLOW },
          ]}
          formatValue={(v) => compactMoney(v, currency)}
        />
      </SectionCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="AR aging" subtitle="Outstanding balance by age">
          <ProgressMeter segments={aging} formatValue={(v) => money(v, currency)} />
        </SectionCard>
        <SectionCard title="Invoices by status">
          <DonutChart
            centerLabel="invoices"
            centerValue={`${fin.invoiceCount}`}
            data={statusEntries(fin.statusCounts, INVOICE_COLORS)}
          />
        </SectionCard>
      </div>

      <SectionCard title="Top customers by balance" action={{ href: '/modules/customers', label: 'Open customers →' }}>
        <SimpleTable
          headers={['Customer', 'Open balance', 'Overdue']}
          align={['left', 'right', 'right']}
          rows={fin.topCustomers.map((c) => [
            c.name,
            money(c.balance, currency),
            c.overdue > 0 ? <span className="font-semibold text-rose-600">{money(c.overdue, currency)}</span> : '—',
          ])}
          empty="No outstanding balances."
        />
      </SectionCard>
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
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <KpiCard label="Total quoted" value={money(sales.totalQuoted, currency)} />
        <KpiCard label="Approved value" value={money(sales.approvedValue, currency)} accent="text-emerald-600" />
        <KpiCard label="Conversion" value={`${sales.conversionRate}%`} accent="text-primary" />
        <KpiCard label="Open quotes" value={`${sales.winLoss.open}`} />
      </div>

      <SectionCard title="Quoted vs approved" subtitle="By quote issue month">
        <BarChart
          data={monthly.map((m) => ({ label: m.month, values: [m.quoted, m.approved] }))}
          series={[
            { name: 'Quoted', color: BRAND_BLUE },
            { name: 'Approved', color: '#10b981' },
          ]}
          formatValue={(v) => compactMoney(v, currency)}
        />
      </SectionCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Quotes by status">
          <DonutChart
            centerLabel="quotes"
            centerValue={`${sales.quoteCount}`}
            data={statusEntries(sales.statusCounts, QUOTE_COLORS)}
          />
        </SectionCard>
        <SectionCard title="Win / loss" subtitle="Decided quotes">
          <ProgressMeter
            segments={[
              { label: 'Won', value: sales.winLoss.won, color: '#10b981' },
              { label: 'Lost', value: sales.winLoss.lost, color: '#f43f5e' },
              { label: 'Open', value: sales.winLoss.open, color: '#94a3b8' },
            ]}
          />
        </SectionCard>
      </div>

      <SectionCard title="Top customers by quoted value" action={{ href: '/modules/quotes', label: 'Open quotes →' }}>
        <SimpleTable
          headers={['Customer', 'Quoted value', 'Quotes']}
          align={['left', 'right', 'right']}
          rows={sales.topCustomers.map((c) => [c.name, money(c.value, currency), c.count])}
          empty="No quotes yet."
        />
      </SectionCard>
    </div>
  );
}

/* ---------- Operations ---------- */

function OperationsTab({ ops }: { ops: ReportData['operations'] }) {
  const resourceMeter = (r: ReportData['operations']['fleet']) => [
    { label: 'Busy', value: r.busy, color: BRAND_BLUE },
    { label: 'Idle', value: r.idle, color: '#cbd5e1' },
  ];
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <KpiCard label="Active trips" value={`${ops.activeTrips}`} accent="text-primary" />
        <KpiCard label="Fleet in use" value={`${ops.fleet.busy}/${ops.fleet.total}`} />
        <KpiCard label="Drivers on duty" value={`${ops.drivers.busy}/${ops.drivers.total}`} />
        <KpiCard label="Officers on duty" value={`${ops.officers.busy}/${ops.officers.total}`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Trips by status">
          <DonutChart centerLabel="trips" centerValue={`${ops.totalTrips}`} data={statusEntries(ops.tripStatusCounts, TRIP_COLORS)} />
        </SectionCard>
        <SectionCard title="Assignments by status">
          <DonutChart
            centerLabel="assignments"
            centerValue={`${Object.values(ops.assignmentStatusCounts).reduce((a, b) => a + b, 0)}`}
            data={statusEntries(ops.assignmentStatusCounts, {
              Planned: '#0ea5e9',
              Confirmed: '#03458f',
              Active: '#f9b232',
              Completed: '#10b981',
              Cancelled: '#f43f5e',
            })}
          />
        </SectionCard>
      </div>

      <SectionCard title="Resource utilization" subtitle="Busy vs idle across the fleet" action={{ href: '/modules/task-assignment', label: 'Open assignments →' }}>
        <div className="space-y-5">
          {([
            ['Vehicles', ops.fleet],
            ['Drivers', ops.drivers],
            ['Officers', ops.officers],
          ] as const).map(([label, r]) => (
            <div key={label}>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-medium text-gray-700">{label}</span>
                <span className="text-gray-400">{r.total === 0 ? '—' : `${Math.round((r.busy / r.total) * 100)}% in use`}</span>
              </div>
              <ProgressMeter segments={resourceMeter(r)} />
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}

/* ---------- Compliance ---------- */

function ComplianceTab({ comp }: { comp: ReportData['compliance'] }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3 lg:gap-4">
        <KpiCard label="Valid" value={`${comp.license.valid}`} accent="text-emerald-600" />
        <KpiCard label="Expiring soon" value={`${comp.license.expiringSoon}`} accent={comp.license.expiringSoon > 0 ? 'text-amber-600' : 'text-gray-900'} />
        <KpiCard label="Expired" value={`${comp.license.expired}`} accent={comp.license.expired > 0 ? 'text-rose-600' : 'text-gray-900'} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Licences by status">
          <DonutChart
            centerLabel="licences"
            centerValue={`${comp.license.total}`}
            data={[
              { label: 'Valid', value: comp.license.valid, color: LICENSE_COLORS.Valid },
              { label: 'Expiring Soon', value: comp.license.expiringSoon, color: LICENSE_COLORS['Expiring Soon'] },
              { label: 'Expired', value: comp.license.expired, color: LICENSE_COLORS.Expired },
            ].filter((d) => d.value > 0)}
          />
        </SectionCard>
        <SectionCard title="Soonest expiries" action={{ href: '/modules/drivers-license-expiry', label: 'Open licences →' }}>
          <SimpleTable
            headers={['Driver', 'Expiry', 'Status']}
            align={['left', 'left', 'left']}
            rows={comp.upcoming.map((l) => [
              <div key={l.licenseNumber}>
                <p className="font-medium text-gray-900">{l.name}</p>
                <p className="text-xs text-gray-400">{l.licenseNumber} · {l.category}</p>
              </div>,
              <div key="exp">
                <p className="text-gray-700">{formatDate(l.expiry)}</p>
                <p className="text-xs text-gray-400">{l.daysRemaining < 0 ? `${Math.abs(l.daysRemaining)}d ago` : `in ${l.daysRemaining}d`}</p>
              </div>,
              <span key="badge" className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${LICENSE_BADGE[l.status] ?? 'bg-gray-100 text-gray-600'}`}>
                {l.status}
              </span>,
            ])}
            empty="No licences tracked yet."
          />
        </SectionCard>
      </div>
    </div>
  );
}

/* ---------- Shared primitives ---------- */

function KpiCard({
  label,
  value,
  accent = 'text-gray-900',
  spark,
  sparkColor,
}: {
  label: string;
  value: string;
  accent?: string;
  spark?: number[];
  sparkColor?: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 lg:p-5">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`mt-2 text-xl font-bold lg:text-2xl ${accent}`}>{value}</p>
      {spark && spark.some((v) => v !== 0) && (
        <div className="mt-3">
          <Sparkline values={spark} color={sparkColor} />
        </div>
      )}
    </div>
  );
}

function SectionCard({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 lg:p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-gray-400">{subtitle}</p>}
        </div>
        {action && (
          <Link href={action.href} className="shrink-0 text-xs font-semibold text-primary hover:text-primary/80">
            {action.label}
          </Link>
        )}
      </div>
      {children}
    </div>
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
                <td key={ci} className={`px-3 py-3 text-sm text-gray-700 ${align[ci] === 'right' ? 'text-right' : ''}`}>
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
