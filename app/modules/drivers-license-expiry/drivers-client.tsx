'use client';

import React, { useMemo, useState } from 'react';

/**
 * Org-wide driving-licence watchlist.
 *
 * Licences are now owned by the person who holds them, and are added, renewed
 * and deleted from the Personnel / Drivers directory. This page is the
 * read-only compliance view over the same rows: who is expired, who is about to
 * be, and which licences were never matched to a person.
 */

const BRAND = '#03458f';

type License = {
  id: number;
  driverName: string;
  personnelId: number | null;
  licenseNumber: string;
  category: string;
  expiryDate: string;
  lastVerified: string | null;
  notes: string | null;
  status: 'Valid' | 'Expiring Soon' | 'Expired';
  daysRemaining: number;
  hasDocument: boolean;
  createdAt: string;
};

type Stats = { total: number; expired: number; expiringSoon: number; valid: number };

type Filter = 'All' | 'Valid' | 'Expiring Soon' | 'Expired' | 'Unlinked';

const FILTERS: Filter[] = ['All', 'Valid', 'Expiring Soon', 'Expired', 'Unlinked'];

const STATUS_TONE: Record<string, string> = {
  Valid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Expiring Soon': 'bg-amber-50 text-amber-700 border-amber-200',
  Expired: 'bg-rose-50 text-rose-700 border-rose-200',
};

const AVATAR_TINTS = ['#03458f', '#2563eb', '#0891b2', '#6366f1', '#475569', '#0284c7'];
function avatarTint(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_TINTS[Math.abs(hash) % AVATAR_TINTS.length];
}
function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
}

type Props = {
  isAdmin: boolean;
  canOpenPersonnel: boolean;
  initialItems: License[];
  initialStats: Stats;
};

export default function DriversClient({ isAdmin, canOpenPersonnel, initialItems, initialStats }: Props) {
  const [items, setItems] = useState<License[]>(initialItems);
  const [stats, setStats] = useState<Stats>(initialStats);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('All');
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    try {
      const res = await fetch('/api/drivers', { credentials: 'include' });
      if (!res.ok) return;
      const data = (await res.json()) as { items?: License[]; stats?: Stats };
      if (data.items) setItems(data.items);
      if (data.stats) setStats(data.stats);
    } catch {
      /* keep current data on transient failure */
    }
  };

  const unlinkedCount = useMemo(() => items.filter((l) => l.personnelId === null).length, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((l) => {
      if (filter === 'Unlinked' && l.personnelId !== null) return false;
      if (filter !== 'All' && filter !== 'Unlinked' && l.status !== filter) return false;
      if (!q) return true;
      return `${l.driverName} ${l.licenseNumber}`.toLowerCase().includes(q);
    });
  }, [items, search, filter]);

  const removeLicence = async (id: number) => {
    if (!window.confirm('Delete this licence record? This cannot be undone.')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/drivers/${id}`, { method: 'DELETE', credentials: 'include' });
      if (res.ok) await reload();
    } finally {
      setBusy(false);
    }
  };

  const personHref = (l: License) => `/modules/drivers?person=${l.personnelId}`;

  const statCards = [
    { label: 'Total licences', value: stats.total },
    { label: 'Expired', value: stats.expired },
    { label: 'Expiring soon', value: stats.expiringSoon },
    { label: 'Valid', value: stats.valid },
  ];

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-10">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Licence Compliance</h1>
            <p className="text-gray-500 mt-1 text-sm">
              Every driving licence on file, soonest expiry first. Licences are added and renewed on the person.
            </p>
          </div>
          {canOpenPersonnel && (
            <a href="/modules/drivers" className="self-start md:self-auto inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm transition-colors hover:opacity-95" style={{ backgroundColor: BRAND }}>
              Open Drivers
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </a>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          {statCards.map((s) => (
            <div key={s.label} className="bg-white p-4 rounded-2xl border border-gray-100">
              <p className="text-xs text-gray-400 mb-1">{s.label}</p>
              <p className="text-xl font-semibold text-gray-900">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Rows whose holder could not be matched to a person during the backfill.
            Nothing was guessed, so these need a human to reconcile them. */}
        {unlinkedCount > 0 && filter !== 'Unlinked' && (
          <div className="mb-5 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800 flex items-center justify-between gap-3">
            <span>
              {unlinkedCount} licence{unlinkedCount === 1 ? ' is' : 's are'} not linked to a personnel record.
            </span>
            <button onClick={() => setFilter('Unlinked')} className="text-xs font-semibold underline hover:no-underline shrink-0">
              Review
            </button>
          </div>
        )}

        {/* Search + filters */}
        <div className="flex flex-col lg:flex-row lg:items-center gap-3 mb-5">
          <div className="relative flex-1">
            <svg className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input type="text" placeholder="Search by driver or licence number…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#03458f]/30" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3.5 py-2 rounded-xl text-sm font-medium border transition-colors ${
                  filter === f ? 'text-white border-transparent' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                }`}
                style={filter === f ? { backgroundColor: BRAND } : undefined}
              >
                {f}
                {f === 'Unlinked' && unlinkedCount > 0 ? ` (${unlinkedCount})` : ''}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        {filtered.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-gray-200">
            <p className="text-gray-900 font-medium">{items.length === 0 ? 'No licences on file' : 'No matching licences'}</p>
            <p className="text-gray-500 text-sm mt-1">
              {items.length === 0
                ? 'Add a licence from a driver’s record in the Drivers directory.'
                : 'Try a different search or filter.'}
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/60">
                    <th className="text-left font-medium text-gray-500 px-5 py-3">Holder</th>
                    <th className="text-left font-medium text-gray-500 px-5 py-3">Licence</th>
                    <th className="text-left font-medium text-gray-500 px-5 py-3">Expires</th>
                    <th className="text-left font-medium text-gray-500 px-5 py-3">Status</th>
                    <th className="text-right font-medium text-gray-500 px-5 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((l) => (
                    <tr key={l.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-lg text-white text-xs font-semibold shrink-0" style={{ backgroundColor: avatarTint(l.driverName) }}>
                            {initials(l.driverName)}
                          </div>
                          <div className="min-w-0">
                            {l.personnelId && canOpenPersonnel ? (
                              <a href={personHref(l)} className="font-medium text-[#03458f] hover:underline truncate block">
                                {l.driverName}
                              </a>
                            ) : (
                              <span className="font-medium text-gray-900 truncate block">{l.driverName}</span>
                            )}
                            {l.personnelId === null && (
                              <span className="text-xs text-amber-600">Not linked to a person</span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <span className="text-gray-900">{l.licenseNumber}</span>
                        <span className="text-gray-400 text-xs block">{l.category}</span>
                      </td>
                      <td className="px-5 py-3">
                        <span className="text-gray-900">{formatDate(l.expiryDate)}</span>
                        <span className="text-gray-400 text-xs block">
                          {l.status === 'Expired' ? `${Math.abs(l.daysRemaining)}d ago` : `${l.daysRemaining}d left`}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-md text-xs border ${STATUS_TONE[l.status]}`}>{l.status}</span>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-3">
                          {l.hasDocument && (
                            <a href={`/api/drivers/${l.id}/document`} target="_blank" rel="noreferrer" className="text-xs font-semibold text-[#03458f] hover:underline">
                              Document
                            </a>
                          )}
                          {isAdmin && (
                            <button onClick={() => removeLicence(l.id)} disabled={busy} className="text-xs font-semibold text-rose-600 hover:underline disabled:opacity-50">
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
