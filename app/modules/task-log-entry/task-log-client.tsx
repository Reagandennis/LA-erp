'use client';

import { APP_LOCALE } from '@/lib/locale';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import type { TaskLogEntry, TaskLogState } from '@/lib/task-log';

interface TaskLogClientProps {
  entries: TaskLogEntry[];
  isAdmin: boolean;
}

type Filter = 'All' | TaskLogState;
const FILTERS: Filter[] = ['All', 'Active', 'Completed', 'Deleted'];

const STATE_STYLES: Record<TaskLogState, string> = {
  Active: 'bg-blue-50 text-blue-700',
  Completed: 'bg-emerald-50 text-emerald-700',
  Deleted: 'bg-rose-50 text-rose-700',
};

const PRIORITY_STYLES: Record<string, string> = {
  high: 'bg-rose-50 text-rose-700',
  medium: 'bg-amber-50 text-amber-700',
  low: 'bg-gray-100 text-gray-600',
};

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(APP_LOCALE, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString(APP_LOCALE, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function titleCase(value: string) {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

export default function TaskLogClient({ entries, isAdmin }: TaskLogClientProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<Filter>('All');
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return entries.filter((entry) => {
      const matchesSearch =
        q.length === 0 ||
        entry.title.toLowerCase().includes(q) ||
        (entry.description?.toLowerCase().includes(q) ?? false) ||
        entry.owner.name.toLowerCase().includes(q);
      const matchesFilter = activeFilter === 'All' || entry.state === activeFilter;
      return matchesSearch && matchesFilter;
    });
  }, [entries, searchQuery, activeFilter]);

  const totals = useMemo(
    () => ({
      total: entries.length,
      active: entries.filter((e) => e.state === 'Active').length,
      completed: entries.filter((e) => e.state === 'Completed').length,
      deleted: entries.filter((e) => e.state === 'Deleted').length,
    }),
    [entries],
  );

  const selected = selectedId === null ? null : entries.find((e) => e.id === selectedId) ?? null;
  const hasEntries = entries.length > 0;

  return (
    <div className="min-h-screen bg-gray-50/50 p-4 sm:p-6 lg:p-10">
      <div className="mx-auto max-w-7xl space-y-6 lg:space-y-8">
        <header>
          <h1 className="text-2xl font-bold tracking-tight text-primary sm:text-3xl">Task Log</h1>
          <p className="mt-1 text-sm text-gray-500">
            A complete history of every task — including completed and deleted ones.
            {isAdmin ? ' Showing all users.' : ' Showing your tasks.'}
          </p>
        </header>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          <SummaryCard label="Total tasks" value={`${totals.total}`} accent="text-primary" />
          <SummaryCard label="Active" value={`${totals.active}`} accent="text-blue-600" />
          <SummaryCard label="Completed" value={`${totals.completed}`} accent="text-emerald-600" />
          <SummaryCard label="Deleted" value={`${totals.deleted}`} accent={totals.deleted > 0 ? 'text-rose-600' : 'text-gray-900'} />
        </div>

        <div className="flex flex-col gap-3 rounded-2xl border border-gray-100 bg-white p-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <svg
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
            </svg>
            <input
              type="text"
              placeholder={isAdmin ? 'Search by task, note, or person…' : 'Search by task or note…'}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="w-full rounded-xl bg-gray-50 py-2.5 pl-10 pr-4 text-sm text-gray-900 placeholder:text-gray-400 transition focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide">
            {FILTERS.map((status) => (
              <button
                type="button"
                key={status}
                onClick={() => setActiveFilter(status)}
                className={`whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                  activeFilter === status ? 'bg-primary text-white' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                }`}
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        {/* Mobile cards */}
        <div className="space-y-3 md:hidden">
          {filtered.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setSelectedId(entry.id)}
              className="w-full rounded-2xl border border-gray-100 bg-white p-4 text-left transition-colors hover:border-primary/30"
            >
              <div className="flex items-start justify-between gap-3">
                <p className={`min-w-0 truncate text-sm font-semibold ${entry.state === 'Deleted' ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                  {entry.title}
                </p>
                <StateBadge state={entry.state} />
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-gray-400">
                <span>{isAdmin ? entry.owner.name : `Updated ${formatDate(entry.updatedAt)}`}</span>
                <span>Due {formatDate(entry.dueDate)}</span>
              </div>
            </button>
          ))}
          {filtered.length === 0 && <EmptyState filtered={hasEntries} />}
        </div>

        {/* Desktop table */}
        <div className="hidden overflow-hidden rounded-2xl border border-gray-100 bg-white md:block">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-gray-400">Task</th>
                {isAdmin && <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-gray-400">Owner</th>}
                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-gray-400">Due</th>
                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-gray-400">Last updated</th>
                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-gray-400">State</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map((entry) => (
                <tr
                  key={entry.id}
                  onClick={() => setSelectedId(entry.id)}
                  className="group cursor-pointer transition-colors hover:bg-gray-50/70"
                >
                  <td className="px-6 py-4">
                    <p className={`text-sm font-semibold transition-colors group-hover:text-primary ${entry.state === 'Deleted' ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                      {entry.title}
                    </p>
                    {entry.description && <p className="truncate text-xs text-gray-400">{entry.description}</p>}
                  </td>
                  {isAdmin && (
                    <td className="px-6 py-4">
                      <p className="text-sm text-gray-700">{entry.owner.name}</p>
                    </td>
                  )}
                  <td className="px-6 py-4">
                    <p className="text-sm text-gray-500">{formatDate(entry.dueDate)}</p>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-sm text-gray-500">{formatDate(entry.updatedAt)}</p>
                  </td>
                  <td className="px-6 py-4">
                    <StateBadge state={entry.state} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <EmptyState filtered={hasEntries} />}
        </div>
      </div>

      {selected && <TaskLogDrawer entry={selected} isAdmin={isAdmin} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

function StateBadge({ state }: { state: TaskLogState }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATE_STYLES[state]}`}>
      {state}
    </span>
  );
}

function SummaryCard({ label, value, accent = 'text-gray-900' }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 lg:p-5">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`mt-2 text-xl font-bold lg:text-2xl ${accent}`}>{value}</p>
    </div>
  );
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="px-6 py-16 text-center sm:py-20">
      <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-50 text-gray-300">
        <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-gray-900">{filtered ? 'No matching tasks' : 'No tasks logged yet'}</h3>
      <p className="mx-auto mt-1 max-w-sm text-sm text-gray-500">
        {filtered ? 'Try a different search or filter.' : 'Tasks you create will appear here — even after they are completed or deleted.'}
      </p>
    </div>
  );
}

function TaskLogDrawer({ entry, isAdmin, onClose }: { entry: TaskLogEntry; isAdmin: boolean; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-gray-900/20 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-full flex-col overflow-y-auto bg-white shadow-2xl sm:max-w-xl">
        <div className="relative overflow-hidden bg-primary px-6 py-6 text-white sm:px-8 sm:py-8">
          <div className="relative z-10 mb-5 flex items-start justify-between gap-4">
            <h2 className="min-w-0 text-2xl font-bold tracking-tight">{entry.title}</h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
              aria-label="Close"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="relative z-10 flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATE_STYLES[entry.state]}`}>{entry.state}</span>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${PRIORITY_STYLES[entry.priority] ?? PRIORITY_STYLES.low}`}>
              {titleCase(entry.priority)} priority
            </span>
            <span className="rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold text-white">{entry.status}</span>
          </div>
          <div className="absolute -bottom-10 -right-10 h-48 w-48 rounded-full bg-secondary/10 blur-3xl" />
        </div>

        <div className="flex-1 space-y-6 px-6 py-6 sm:px-8">
          {entry.description && (
            <div className="rounded-2xl border border-gray-100 bg-gray-50/60 p-5 text-sm whitespace-pre-wrap text-gray-700">
              {entry.description}
            </div>
          )}

          <dl className="grid grid-cols-2 gap-3">
            {isAdmin && <Cell label="Owner" value={entry.owner.name} />}
            <Cell label="Due date" value={formatDate(entry.dueDate)} />
            <Cell label="Created" value={formatDateTime(entry.createdAt)} />
            <Cell label="Last updated" value={formatDateTime(entry.updatedAt)} />
            {entry.completedAt && <Cell label="Completed" value={formatDateTime(entry.completedAt)} accent="text-emerald-600" />}
            {entry.deletedAt && <Cell label="Deleted" value={formatDateTime(entry.deletedAt)} accent="text-rose-600" />}
          </dl>

          <Link
            href="/modules/todo-personal"
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
          >
            Open in Tasks
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </Link>
        </div>
      </div>
    </>
  );
}

function Cell({ label, value, accent = 'text-gray-900' }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3">
      <dt className="text-xs font-medium text-gray-400">{label}</dt>
      <dd className={`mt-0.5 text-sm font-semibold ${accent}`}>{value}</dd>
    </div>
  );
}
