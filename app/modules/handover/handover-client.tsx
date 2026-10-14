'use client';

import { APP_LOCALE } from '@/lib/locale';
import { useMemo, useState } from 'react';

import HandoverDetailDrawer from './handover-detail-drawer';
import HandoverForm from './handover-form';
import { HANDOVER_STATUSES, type HandoverData, type HandoverDetail, type StatusFilter } from './types';

const STATUS_FILTERS: StatusFilter[] = ['All', 'Awaiting', ...HANDOVER_STATUSES];

const STATUS_STYLES: Record<string, string> = {
  Normal: 'bg-slate-100 text-slate-600',
  Attention: 'bg-amber-50 text-amber-700',
  Urgent: 'bg-rose-50 text-rose-700',
};

function formatShiftDate(value: string) {
  return new Date(value).toLocaleDateString(APP_LOCALE, { month: 'short', day: 'numeric', year: 'numeric' });
}

interface HandoverClientProps {
  currentUser: { id: number; name: string };
  isAdmin: boolean;
  initialData: HandoverData;
}

export default function HandoverClient({ currentUser, isAdmin, initialData }: HandoverClientProps) {
  const [handovers, setHandovers] = useState<HandoverDetail[]>(initialData.handovers);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [formState, setFormState] = useState<
    { open: false } | { open: true; mode: 'create' } | { open: true; mode: 'edit'; handover: HandoverDetail }
  >({ open: false });
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<StatusFilter>('All');
  // Capture the clock once at mount (lazy init keeps re-renders pure).
  const [nowMs] = useState(() => Date.now());

  const stats = useMemo(() => {
    const weekAgo = nowMs - 7 * 24 * 60 * 60 * 1000;
    return {
      awaiting: handovers.filter((h) => !h.acknowledgedBy).length,
      attention: handovers.filter((h) => !h.acknowledgedBy && (h.status === 'Attention' || h.status === 'Urgent')).length,
      thisWeek: handovers.filter((h) => new Date(h.createdAt).getTime() >= weekAgo).length,
      total: handovers.length,
    };
  }, [handovers, nowMs]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return handovers.filter((h) => {
      const matchesSearch =
        q.length === 0 ||
        (h.post?.toLowerCase().includes(q) ?? false) ||
        h.summary.toLowerCase().includes(q) ||
        (h.createdBy?.name.toLowerCase().includes(q) ?? false);
      const matchesFilter =
        activeFilter === 'All' ||
        (activeFilter === 'Awaiting' ? !h.acknowledgedBy : h.status === activeFilter);
      return matchesSearch && matchesFilter;
    });
  }, [handovers, searchQuery, activeFilter]);

  const upsert = (handover: HandoverDetail) => {
    setHandovers((current) => {
      const without = current.filter((h) => h.id !== handover.id);
      return [handover, ...without].sort(
        (a, b) => new Date(b.shiftDate).getTime() - new Date(a.shiftDate).getTime() || b.id - a.id,
      );
    });
  };
  const remove = (id: number) => setHandovers((current) => current.filter((h) => h.id !== id));

  const hasAny = handovers.length > 0;

  return (
    <div className="min-h-screen bg-gray-50/50 p-4 sm:p-6 lg:p-10">
      <div className="mx-auto max-w-7xl space-y-6 lg:space-y-8">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-primary sm:text-3xl">Handover</h1>
            <p className="mt-1 text-sm text-gray-500">
              Record the situation at end of shift, flag what the next team must watch, and acknowledge receipt.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setFormState({ open: true, mode: 'create' })}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m7-7H5" />
            </svg>
            New handover
          </button>
        </header>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          <SummaryCard label="Awaiting receipt" value={`${stats.awaiting}`} accent={stats.awaiting > 0 ? 'text-amber-600' : 'text-gray-900'} />
          <SummaryCard label="Needs attention" value={`${stats.attention}`} accent={stats.attention > 0 ? 'text-rose-600' : 'text-gray-900'} />
          <SummaryCard label="This week" value={`${stats.thisWeek}`} />
          <SummaryCard label="Total logged" value={`${stats.total}`} />
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
              placeholder="Search by post, officer, or summary…"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="w-full rounded-xl bg-gray-50 py-2.5 pl-10 pr-4 text-sm text-gray-900 placeholder:text-gray-400 transition focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide">
            {STATUS_FILTERS.map((status) => (
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
          {filtered.map((h) => (
            <button
              key={h.id}
              type="button"
              onClick={() => setSelectedId(h.id)}
              className="w-full rounded-2xl border border-gray-100 bg-white p-4 text-left transition-colors hover:border-primary/30"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-gray-900">
                    {h.post ?? 'General'} · {h.shiftPeriod} shift
                  </p>
                  <p className="truncate text-sm text-gray-500">{h.summary}</p>
                </div>
                <StatusBadge status={h.status} />
              </div>
              <div className="mt-3 flex items-center justify-between">
                <p className="text-xs text-gray-400">
                  {formatShiftDate(h.shiftDate)}
                  {h.createdBy ? ` · ${h.createdBy.name}` : ''}
                </p>
                <AckPill handover={h} />
              </div>
            </button>
          ))}
          {filtered.length === 0 && <EmptyState filtered={hasAny} onCreate={() => setFormState({ open: true, mode: 'create' })} />}
        </div>

        {/* Desktop table */}
        <div className="hidden overflow-hidden rounded-2xl border border-gray-100 bg-white md:block">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-gray-400">Shift</th>
                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-gray-400">Post</th>
                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-gray-400">Outgoing</th>
                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-gray-400">Status</th>
                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-gray-400">Receipt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map((h) => (
                <tr
                  key={h.id}
                  onClick={() => setSelectedId(h.id)}
                  className="group cursor-pointer transition-colors hover:bg-gray-50/70"
                >
                  <td className="px-6 py-4">
                    <p className="text-sm font-semibold text-gray-900 transition-colors group-hover:text-primary">
                      {formatShiftDate(h.shiftDate)}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-400">{h.shiftPeriod} shift</p>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-sm text-gray-700">{h.post ?? 'General'}</p>
                    <p className="mt-0.5 max-w-xs truncate text-xs text-gray-400">{h.summary}</p>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-sm text-gray-500">{h.createdBy?.name ?? '—'}</p>
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge status={h.status} />
                  </td>
                  <td className="px-6 py-4">
                    <AckPill handover={h} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <EmptyState filtered={hasAny} onCreate={() => setFormState({ open: true, mode: 'create' })} />}
        </div>
      </div>

      {formState.open && (
        <HandoverForm
          mode={formState.mode}
          handover={formState.mode === 'edit' ? formState.handover : null}
          onClose={() => setFormState({ open: false })}
          onSaved={(handover) => {
            upsert(handover);
            setFormState({ open: false });
            setSelectedId(handover.id);
          }}
        />
      )}

      {selectedId !== null && (
        <HandoverDetailDrawer
          handoverId={selectedId}
          currentUser={currentUser}
          isAdmin={isAdmin}
          onClose={() => setSelectedId(null)}
          onChanged={(handover) => upsert(handover)}
          onDeleted={(id) => {
            remove(id);
            setSelectedId(null);
          }}
          onEdit={(handover) => {
            setSelectedId(null);
            setFormState({ open: true, mode: 'edit', handover });
          }}
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
        STATUS_STYLES[status] ?? STATUS_STYLES.Normal
      }`}
    >
      {status}
    </span>
  );
}

function AckPill({ handover }: { handover: HandoverDetail }) {
  if (handover.acknowledgedBy) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
        Acknowledged
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
      Awaiting
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

function EmptyState({ filtered, onCreate }: { filtered: boolean; onCreate: () => void }) {
  return (
    <div className="px-6 py-16 text-center sm:py-20">
      <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-50 text-gray-300">
        <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-gray-900">{filtered ? 'No matching handovers' : 'No handovers yet'}</h3>
      <p className="mx-auto mt-1 max-w-sm text-sm text-gray-500">
        {filtered ? 'Try a different search or clear the active filter.' : 'Log the first shift handover to get started.'}
      </p>
      {!filtered && (
        <button
          type="button"
          onClick={onCreate}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
        >
          New handover
        </button>
      )}
    </div>
  );
}
