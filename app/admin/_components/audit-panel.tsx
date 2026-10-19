'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { AdminUser, AuditLogEntry, AuditQueryResult } from './admin-types';
import { Drawer, EmptyState, SearchInput, describeAction, describeEntityType, formatDateTime, formatIp, inputClass, secondaryButton } from './admin-ui';

export type AuditFilterState = {
  q: string;
  action: string;
  entityType: string;
  actorId: string;
  from: string;
  to: string;
  page: number;
  pageSize: number;
};

export const EMPTY_AUDIT_FILTERS: AuditFilterState = {
  q: '',
  action: '',
  entityType: '',
  actorId: '',
  from: '',
  to: '',
  page: 1,
  pageSize: 25,
};

export function buildAuditQuery(f: AuditFilterState): string {
  const sp = new URLSearchParams();
  if (f.q.trim()) sp.set('q', f.q.trim());
  if (f.action) sp.set('action', f.action);
  if (f.entityType) sp.set('entityType', f.entityType);
  if (f.actorId) sp.set('actorId', f.actorId);
  if (f.from) sp.set('from', f.from);
  if (f.to) sp.set('to', f.to);
  sp.set('page', String(f.page));
  sp.set('pageSize', String(f.pageSize));
  return sp.toString();
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-gray-50 py-2">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="break-words text-right text-sm font-medium text-gray-900">{value}</span>
    </div>
  );
}

export default function AuditPanel({
  initial,
  initialAction,
  users,
}: {
  initial: AuditQueryResult;
  /** Pre-applied action filter, e.g. failed sign-ins from the overview. */
  initialAction: string;
  users: AdminUser[];
}) {
  const startFilters = { ...EMPTY_AUDIT_FILTERS, action: initialAction };
  const [audit, setAudit] = useState<AuditQueryResult>(initial);
  const [filters, setFilters] = useState<AuditFilterState>(startFilters);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selected, setSelected] = useState<AuditLogEntry | null>(null);
  const firstRun = useRef(true);

  const fetchAudit = useCallback(async (next: AuditFilterState) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/audit?${buildAuditQuery(next)}`, { credentials: 'include' });
      if (res.ok) setAudit((await res.json()) as AuditQueryResult);
    } catch {
      /* keep the current page */
    } finally {
      setLoading(false);
    }
  }, []);

  // Re-query when filters change (debounced for typing). The first run with
  // default filters is already covered by the server-rendered page.
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      if (!initialAction) return;
    }
    const t = setTimeout(() => void fetchAudit(filters), 250);
    return () => clearTimeout(t);
  }, [filters, fetchAudit, initialAction]);

  const setFilter = (patch: Partial<AuditFilterState>) => setFilters((f) => ({ ...f, page: 1, ...patch }));

  const exportCsv = async () => {
    setExporting(true);
    try {
      const res = await fetch(`/api/admin/audit?${buildAuditQuery({ ...filters, page: 1, pageSize: 1000 })}`, { credentials: 'include' });
      if (!res.ok) return;
      const data = (await res.json()) as AuditQueryResult;
      const header = ['Timestamp', 'Action', 'Description', 'Entity type', 'Entity id', 'Actor', 'Target', 'IP', 'User agent', 'Metadata'];
      const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const rows = data.logs.map((l) =>
        [
          new Date(l.createdAt).toISOString(),
          l.action,
          describeAction(l.action),
          l.entityType,
          l.entityId ?? '',
          l.actor ? `${l.actor.name} <${l.actor.email}>` : '',
          l.target ? `${l.target.name} <${l.target.email}>` : '',
          l.ipAddress ?? '',
          l.userAgent ?? '',
          l.metadata ? JSON.stringify(l.metadata) : '',
        ]
          .map(escape)
          .join(','),
      );
      const csv = [header.map(escape).join(','), ...rows].join('\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  const filtering = JSON.stringify({ ...filters, page: 1, pageSize: 25 }) !== JSON.stringify(EMPTY_AUDIT_FILTERS);

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-2xl border border-gray-100 bg-white p-4">
        <SearchInput value={filters.q} onChange={(q) => setFilter({ q })} placeholder="Search action, person, entity or IP…" />
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
          <select value={filters.action} onChange={(e) => setFilter({ action: e.target.value })} className={inputClass} aria-label="Action">
            <option value="">All actions</option>
            {[...new Set([...audit.facets.actions, ...(filters.action ? [filters.action] : [])])].map((a) => (
              <option key={a} value={a}>
                {describeAction(a)}
              </option>
            ))}
          </select>
          <select value={filters.entityType} onChange={(e) => setFilter({ entityType: e.target.value })} className={inputClass} aria-label="Entity type">
            <option value="">All entities</option>
            {audit.facets.entityTypes.map((t) => (
              <option key={t} value={t}>
                {describeEntityType(t)}
              </option>
            ))}
          </select>
          <select value={filters.actorId} onChange={(e) => setFilter({ actorId: e.target.value })} className={inputClass} aria-label="Done by">
            <option value="">Anyone</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <input type="date" value={filters.from} onChange={(e) => setFilter({ from: e.target.value })} className={inputClass} aria-label="From date" />
          <input type="date" value={filters.to} onChange={(e) => setFilter({ to: e.target.value })} className={inputClass} aria-label="To date" />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-gray-500" aria-live="polite">
            {loading ? 'Loading…' : `${audit.total} event${audit.total === 1 ? '' : 's'}`}
          </p>
          <div className="flex items-center gap-2">
            {filtering && (
              <button type="button" onClick={() => setFilters(EMPTY_AUDIT_FILTERS)} className="px-3 py-1.5 text-sm font-medium text-gray-500 hover:text-gray-700">
                Reset
              </button>
            )}
            <button type="button" onClick={() => void exportCsv()} disabled={exporting || audit.total === 0} className={`${secondaryButton} px-3 py-1.5`}>
              {exporting ? 'Exporting…' : 'Export CSV'}
            </button>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white">
        {audit.logs.length === 0 ? (
          <EmptyState title="No matching events" detail="Adjust the filters above." />
        ) : (
          <ul className="divide-y divide-gray-50">
            {audit.logs.map((log) => (
              <li key={log.id}>
                <button
                  type="button"
                  onClick={() => setSelected(log)}
                  className="flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-gray-50 sm:flex-row sm:items-center sm:gap-4 sm:px-5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-gray-900">
                      {describeAction(log.action)}
                      {log.action.startsWith('auth.login.failed') && (
                        <span className="ml-2 rounded bg-rose-50 px-1.5 py-0.5 text-[11px] font-semibold text-rose-700">Failed</span>
                      )}
                    </span>
                    <span className="block truncate text-xs text-gray-500">
                      {log.actor?.name ?? 'System'}
                      {log.target && log.target.id !== log.actor?.id ? ` → ${log.target.name}` : ''}
                      {!log.target && log.entityId ? ` · ${describeEntityType(log.entityType)} #${log.entityId}` : ''}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3 text-xs text-gray-400">
                    {log.ipAddress && <span className="hidden md:inline">{formatIp(log.ipAddress)}</span>}
                    <span className="sm:w-40 sm:text-right">{formatDateTime(log.createdAt)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-gray-500">
          Rows
          <select
            value={filters.pageSize}
            onChange={(e) => setFilter({ pageSize: Number(e.target.value) })}
            className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-sm"
          >
            {[25, 50, 100, 200].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">
            Page {audit.page} of {audit.totalPages}
          </span>
          <button
            type="button"
            disabled={audit.page <= 1 || loading}
            onClick={() => setFilters((f) => ({ ...f, page: Math.max(1, f.page - 1) }))}
            className={`${secondaryButton} px-3 py-1.5`}
          >
            Previous
          </button>
          <button
            type="button"
            disabled={audit.page >= audit.totalPages || loading}
            onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}
            className={`${secondaryButton} px-3 py-1.5`}
          >
            Next
          </button>
        </div>
      </div>

      {selected && (
        <Drawer title="Event detail" onClose={() => setSelected(null)}>
          <div className="space-y-4 p-6">
            <div>
              <p className="text-base font-semibold text-gray-900">{describeAction(selected.action)}</p>
              <code className="mt-1 inline-block rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-[#03458f]">{selected.action}</code>
            </div>
            <div>
              <DetailRow label="When" value={formatDateTime(selected.createdAt)} />
              <DetailRow label="Done by" value={selected.actor ? `${selected.actor.name} (${selected.actor.email})` : 'System'} />
              <DetailRow label="Affected person" value={selected.target ? `${selected.target.name} (${selected.target.email})` : '—'} />
              <DetailRow label="Entity" value={`${describeEntityType(selected.entityType)}${selected.entityId ? ` #${selected.entityId}` : ''}`} />
              <DetailRow label="IP address" value={selected.ipAddress ? `${formatIp(selected.ipAddress)}${formatIp(selected.ipAddress) !== selected.ipAddress ? ` (${selected.ipAddress})` : ''}` : '—'} />
            </div>
            <div>
              <p className="mb-1 text-xs text-gray-500">Device</p>
              <p className="break-words text-sm text-gray-700">{selected.userAgent ?? '—'}</p>
            </div>
            <div>
              <p className="mb-1 text-xs text-gray-500">Details</p>
              {selected.metadata ? (
                <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-xl border border-gray-100 bg-gray-50 p-3 text-xs text-gray-700">
                  {JSON.stringify(selected.metadata, null, 2)}
                </pre>
              ) : (
                <p className="text-sm text-gray-400">—</p>
              )}
            </div>
          </div>
        </Drawer>
      )}
    </div>
  );
}
