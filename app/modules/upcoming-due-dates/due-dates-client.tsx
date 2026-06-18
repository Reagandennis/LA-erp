'use client';

import React, { useMemo, useState } from 'react';

import type { DueDateBuckets, DueDateItem, DueSource } from '@/lib/due-dates';

const BRAND = '#03458f';

const SOURCE_FILTERS: Array<{ key: DueSource | 'all'; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'invoice', label: 'Invoices' },
  { key: 'quote', label: 'Quotes' },
  { key: 'license', label: 'Licenses' },
  { key: 'contract', label: 'Contracts' },
  { key: 'sop', label: 'SOP reviews' },
  { key: 'trip', label: 'Trips' },
  { key: 'calendar', label: 'Calendar' },
];

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: '2-digit', year: 'numeric' });
}

function formatMoney(amount: number | null, currency: string | null) {
  if (amount == null) return null;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency ?? 'USD', maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency ?? ''} ${amount.toLocaleString()}`.trim();
  }
}

function urgency(days: number): { dot: string; text: string; tone: string } {
  if (days < 0) return { dot: 'bg-rose-500', text: `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`, tone: 'text-rose-600' };
  if (days === 0) return { dot: 'bg-amber-500', text: 'Due today', tone: 'text-amber-600' };
  if (days === 1) return { dot: 'bg-amber-500', text: 'Due tomorrow', tone: 'text-amber-600' };
  if (days <= 7) return { dot: 'bg-amber-500', text: `In ${days} days`, tone: 'text-amber-600' };
  if (days <= 30) return { dot: 'bg-blue-400', text: `In ${days} days`, tone: 'text-gray-500' };
  return { dot: 'bg-gray-300', text: `In ${days} days`, tone: 'text-gray-400' };
}

type Props = {
  initialItems: DueDateItem[];
  initialBuckets: DueDateBuckets;
};

type GroupKey = 'overdue' | 'week' | 'month' | 'later';
const GROUP_ORDER: Array<{ key: GroupKey; label: string }> = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'week', label: 'Due this week' },
  { key: 'month', label: 'Due this month' },
  { key: 'later', label: 'Later' },
];

function groupOf(days: number): GroupKey {
  if (days < 0) return 'overdue';
  if (days <= 7) return 'week';
  if (days <= 30) return 'month';
  return 'later';
}

export default function DueDatesClient({ initialItems, initialBuckets }: Props) {
  const [items] = useState<DueDateItem[]>(initialItems);
  const [buckets] = useState<DueDateBuckets>(initialBuckets);
  const [search, setSearch] = useState('');
  const [source, setSource] = useState<DueSource | 'all'>('all');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((it) => {
      if (source !== 'all' && it.source !== source) return false;
      if (!q) return true;
      return [it.title, it.subtitle, it.sourceLabel].filter(Boolean).some((f) => String(f).toLowerCase().includes(q));
    });
  }, [items, search, source]);

  const grouped = useMemo(() => {
    const g: Record<GroupKey, DueDateItem[]> = { overdue: [], week: [], month: [], later: [] };
    for (const it of filtered) g[groupOf(it.daysRemaining)].push(it);
    return g;
  }, [filtered]);

  const statCards = [
    { label: 'Overdue', value: buckets.overdue, color: 'text-rose-600' },
    { label: 'Due this week', value: buckets.dueThisWeek, color: 'text-amber-600' },
    { label: 'Due this month', value: buckets.dueThisMonth, color: 'text-gray-900' },
    { label: 'Total tracked', value: buckets.total, color: 'text-gray-900' },
  ];

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-10">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-gray-900">Upcoming Due Dates</h1>
          <p className="text-gray-500 mt-1 text-sm">
            Deadlines from across the platform — invoices, quotes, licenses, contracts, SOP reviews, trips, and calendar.
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          {statCards.map((s) => (
            <div key={s.label} className="bg-white p-4 rounded-2xl border border-gray-100">
              <p className="text-xs text-gray-400 mb-1">{s.label}</p>
              <p className={`text-xl font-semibold ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Search + source filters */}
        <div className="flex flex-col gap-3 mb-6">
          <div className="relative">
            <svg className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search deadlines…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#03458f]/30"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {SOURCE_FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setSource(f.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors border ${
                  source === f.key ? 'text-white border-transparent' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                }`}
                style={source === f.key ? { backgroundColor: BRAND } : undefined}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Timeline */}
        {filtered.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-gray-200">
            <p className="text-gray-900 font-medium">{items.length === 0 ? 'Nothing due soon' : 'No matching deadlines'}</p>
            <p className="text-gray-500 text-sm mt-1">
              {items.length === 0 ? 'There are no upcoming deadlines in the tracked window.' : 'Try a different search or source filter.'}
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {GROUP_ORDER.map(({ key, label }) => {
              const list = grouped[key];
              if (list.length === 0) return null;
              return (
                <div key={key}>
                  <div className="flex items-center gap-2 mb-3">
                    <h2 className={`text-sm font-semibold ${key === 'overdue' ? 'text-rose-600' : 'text-gray-900'}`}>{label}</h2>
                    <span className="text-xs text-gray-400">{list.length}</span>
                  </div>
                  <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-50 overflow-hidden">
                    {list.map((it) => {
                      const u = urgency(it.daysRemaining);
                      const money = formatMoney(it.amount, it.currency);
                      return (
                        <a
                          key={it.id}
                          href={it.href}
                          className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 transition-colors"
                        >
                          <span className={`w-2 h-2 rounded-full shrink-0 ${u.dot}`} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-gray-900 truncate">{it.title}</p>
                              <span className="px-2 py-0.5 rounded-md text-xs font-medium bg-gray-50 text-gray-500 border border-gray-100 shrink-0">
                                {it.sourceLabel}
                              </span>
                            </div>
                            {it.subtitle && <p className="text-xs text-gray-400 truncate mt-0.5">{it.subtitle}</p>}
                          </div>
                          <div className="text-right shrink-0">
                            <p className={`text-sm font-medium ${u.tone}`}>{u.text}</p>
                            <p className="text-xs text-gray-400 mt-0.5">
                              {formatDate(it.date)}{money ? ` · ${money}` : ''}
                            </p>
                          </div>
                          <svg className="w-4 h-4 text-gray-300 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </a>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
