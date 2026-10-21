'use client';

import ShowMoreButton from '@/app/ui/show-more-button';
import React, { useEffect, useRef, useState } from 'react';

import type { CustomerOption } from '@/lib/contacts';
import { RISK_LEVELS, TRAVELER_STATUSES } from '@/lib/traveler-options';
import type { TravelerListItem, TravelerStats, TravelerSummary } from '@/lib/travelers';

/**
 * Travellers are the people we protect. They belong to a client account rather
 * than to us, so this directory is deliberately separate from Personnel — and
 * behind its own module grant, because the records carry passport, date-of-birth
 * and medical detail.
 */

const BRAND = '#03458f';

const inputClass =
  'w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#03458f]/30 focus:border-[#03458f]/40';

const RISK_TONE: Record<string, string> = {
  Standard: 'bg-gray-50 text-gray-600 border-gray-200',
  Elevated: 'bg-amber-50 text-amber-700 border-amber-200',
  High: 'bg-rose-50 text-rose-700 border-rose-200',
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
/** Days until a passport expires; negative once it has lapsed. */
function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const then = new Date(iso);
  then.setHours(0, 0, 0, 0);
  return Math.round((then.getTime() - today.getTime()) / 86400000);
}

type Props = {
  isAdmin: boolean;
  /** The first page, unfiltered; later pages and searches come from /api/travelers. */
  initialItems: TravelerListItem[];
  initialTotal: number;
  initialStats: TravelerStats;
  pageSize: number;
  initialCustomers: CustomerOption[];
  /** Traveller to open on arrival, from a `?open=<id>` link. */
  initialOpenId?: number | null;
};

type ListQuery = { q: string; risk: string; status: string };

type PageResponse = {
  items: TravelerListItem[];
  total: number;
  page: number;
  pageSize: number;
  stats: TravelerStats;
};

const SEARCH_DEBOUNCE_MS = 300;

function listUrl(query: ListQuery, page: number, pageSize: number): string {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (query.q.trim()) params.set('q', query.q.trim());
  if (query.risk !== 'All') params.set('risk', query.risk);
  if (query.status !== 'All') params.set('status', query.status);
  return `/api/travelers?${params.toString()}`;
}

/** The list row for a record that was just created or edited. */
function toListItem(t: TravelerSummary): TravelerListItem {
  return {
    id: t.id,
    name: t.name,
    email: t.email,
    phone: t.phone,
    nationality: t.nationality,
    passportExpiry: t.passportExpiry,
    status: t.status,
    riskLevel: t.riskLevel,
    hasPhoto: t.hasPhoto,
    customer: t.customer,
    tripCount: t.tripCount,
  };
}

type Form = {
  name: string;
  customerId: string;
  email: string;
  phone: string;
  nationality: string;
  dateOfBirth: string;
  passportNumber: string;
  passportExpiry: string;
  status: string;
  riskLevel: string;
  dietaryNotes: string;
  medicalNotes: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  notes: string;
};

const EMPTY_FORM: Form = {
  name: '', customerId: '', email: '', phone: '', nationality: '', dateOfBirth: '',
  passportNumber: '', passportExpiry: '', status: 'Active', riskLevel: 'Standard',
  dietaryNotes: '', medicalNotes: '', emergencyContactName: '', emergencyContactPhone: '', notes: '',
};

export default function TravelersClient({
  isAdmin,
  initialItems,
  initialTotal,
  initialStats,
  pageSize,
  initialCustomers,
  initialOpenId = null,
}: Props) {
  const [items, setItems] = useState<TravelerListItem[]>(initialItems);
  const [total, setTotal] = useState(initialTotal);
  const [stats, setStats] = useState<TravelerStats>(initialStats);
  const [customers] = useState<CustomerOption[]>(initialCustomers);
  const [search, setSearch] = useState('');
  const [riskFilter, setRiskFilter] = useState<string>('All');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [page, setPage] = useState(1);
  const [listLoading, setListLoading] = useState(false);
  const [moreLoading, setMoreLoading] = useState(false);

  // The card that is open, and its full record (the list only carries what
  // the cards show). `detail` lags `selectedId` while it loads.
  const [selectedId, setSelectedId] = useState<number | null>(initialOpenId);
  const [detail, setDetail] = useState<TravelerSummary | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photoVersion, setPhotoVersion] = useState<Record<number, number>>({});

  // A new `?open=` link while we're already here re-renders with a new prop but
  // doesn't remount, so open that traveller now (adjusted during render). Any
  // open form is dismissed first, as Cancel would, so an edit can never be saved
  // onto the newly selected record.
  const [openId, setOpenId] = useState(initialOpenId);
  if (openId !== initialOpenId) {
    setOpenId(initialOpenId);
    if (initialOpenId !== null) {
      setFormOpen(false);
      setSelectedId(initialOpenId);
    }
  }

  const query: ListQuery = { q: search, risk: riskFilter, status: statusFilter };
  const queryKey = `${search.trim()}\u0000${riskFilter}\u0000${statusFilter}`;
  // The first page of the unfiltered list arrived with the page; only a
  // changed search or filter has to go to the server.
  const loadedQueryKey = useRef(`\u0000All\u0000All`);
  const requestSeq = useRef(0);

  useEffect(() => {
    if (queryKey === loadedQueryKey.current) return;
    const seq = ++requestSeq.current;
    const timer = window.setTimeout(() => {
      void (async () => {
        setListLoading(true);
        try {
          const res = await fetch(listUrl(query, 1, pageSize), { credentials: 'include', cache: 'no-store' });
          if (!res.ok) return;
          const data = (await res.json()) as PageResponse;
          if (seq !== requestSeq.current) return; // a newer keystroke won
          loadedQueryKey.current = queryKey;
          setItems(data.items);
          setTotal(data.total);
          setStats(data.stats);
          setPage(1);
        } catch {
          /* keep current data on transient failure */
        } finally {
          if (seq === requestSeq.current) setListLoading(false);
        }
      })();
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
    // `query` is derived from the three pieces of state that make up queryKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, pageSize]);

  /** Reload the current search from the first page (after a create or delete). */
  const refresh = async () => {
    const seq = ++requestSeq.current;
    try {
      const res = await fetch(listUrl(query, 1, pageSize), { credentials: 'include', cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as PageResponse;
      if (seq !== requestSeq.current) return;
      loadedQueryKey.current = queryKey;
      setItems(data.items);
      setTotal(data.total);
      setStats(data.stats);
      setPage(1);
    } catch {
      /* keep current data on transient failure */
    }
  };

  const showMore = async () => {
    if (moreLoading) return;
    setMoreLoading(true);
    try {
      const res = await fetch(listUrl(query, page + 1, pageSize), { credentials: 'include', cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as PageResponse;
      setItems((current) => {
        const seen = new Set(current.map((t) => t.id));
        return [...current, ...data.items.filter((t) => !seen.has(t.id))];
      });
      setTotal(data.total);
      setPage(data.page);
    } catch {
      /* keep current data on transient failure */
    } finally {
      setMoreLoading(false);
    }
  };

  // Fetch the full record whenever a different card is opened.
  useEffect(() => {
    if (selectedId === null) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/travelers/${selectedId}`, { credentials: 'include', cache: 'no-store' });
        if (cancelled) return;
        if (!res.ok) {
          setDetail(null);
          setDetailError(res.status === 404 ? 'This traveller no longer exists.' : "This traveller couldn't be loaded.");
          return;
        }
        const data = (await res.json()) as { item: TravelerSummary };
        if (cancelled) return;
        setDetail(data.item);
        setDetailError(null);
      } catch {
        if (!cancelled) setDetailError("This traveller couldn't be loaded.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const selected = detail && detail.id === selectedId ? detail : null;
  const detailLoading = selectedId !== null && selected === null && detailError === null;

  const closeDetail = () => {
    setSelectedId(null);
    setDetailError(null);
  };

  /** A saved record: the drawer shows it and its list row catches up. */
  const applySaved = (t: TravelerSummary) => {
    setDetail(t);
    setItems((current) => current.map((row) => (row.id === t.id ? toListItem(t) : row)));
  };

  const hiddenCount = Math.max(0, total - items.length);

  const statTiles = [
    { label: 'Total travellers', value: stats.total },
    { label: 'Active', value: stats.active },
    { label: 'Elevated / high risk', value: stats.elevatedRisk },
    { label: 'Passport expiring', value: stats.passportExpiring },
  ];

  const photoUrl = (t: { id: number }) =>
    `/api/travelers/${t.id}/photo${photoVersion[t.id] ? `?v=${photoVersion[t.id]}` : ''}`;

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setPendingPhoto(null);
    setPhotoPreview(null);
    setEditing(false);
    setError(null);
    setFormOpen(true);
  };

  const openEdit = (t: TravelerSummary) => {
    setForm({
      name: t.name,
      customerId: t.customer ? String(t.customer.id) : '',
      email: t.email ?? '',
      phone: t.phone ?? '',
      nationality: t.nationality ?? '',
      dateOfBirth: t.dateOfBirth ? t.dateOfBirth.slice(0, 10) : '',
      passportNumber: t.passportNumber ?? '',
      passportExpiry: t.passportExpiry ? t.passportExpiry.slice(0, 10) : '',
      status: t.status,
      riskLevel: t.riskLevel,
      dietaryNotes: t.dietaryNotes ?? '',
      medicalNotes: t.medicalNotes ?? '',
      emergencyContactName: t.emergencyContactName ?? '',
      emergencyContactPhone: t.emergencyContactPhone ?? '',
      notes: t.notes ?? '',
    });
    setPendingPhoto(null);
    setPhotoPreview(null);
    setEditing(true);
    setError(null);
    setFormOpen(true);
  };

  const pickPhoto = (file: File | null) => {
    setPendingPhoto(file);
    setPhotoPreview(file ? URL.createObjectURL(file) : null);
  };

  const uploadPhoto = async (id: number, file: File) => {
    const fd = new FormData();
    fd.append('photo', file);
    const res = await fetch(`/api/travelers/${id}/photo`, { method: 'POST', credentials: 'include', body: fd });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      setError(err?.error ?? 'The photo could not be uploaded.');
      return;
    }
    setPhotoVersion((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));
    setItems((current) => current.map((row) => (row.id === id ? { ...row, hasPhoto: true } : row)));
    setDetail((current) => (current && current.id === id ? { ...current, hasPhoto: true } : current));
  };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('Name is required.');
      return;
    }
    setBusy(true);
    setError(null);
    const body = {
      name: form.name.trim(),
      customerId: form.customerId ? Number(form.customerId) : null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      nationality: form.nationality.trim() || null,
      dateOfBirth: form.dateOfBirth || null,
      passportNumber: form.passportNumber.trim() || null,
      passportExpiry: form.passportExpiry || null,
      status: form.status,
      riskLevel: form.riskLevel,
      dietaryNotes: form.dietaryNotes.trim() || null,
      medicalNotes: form.medicalNotes.trim() || null,
      emergencyContactName: form.emergencyContactName.trim() || null,
      emergencyContactPhone: form.emergencyContactPhone.trim() || null,
      notes: form.notes.trim() || null,
    };
    try {
      if (editing && selectedId) {
        const res = await fetch(`/api/travelers/${selectedId}`, {
          method: 'PATCH', credentials: 'include',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok) {
          setError(payload?.error ?? 'Could not update the traveller.');
          setBusy(false);
          return;
        }
        if (payload?.item) applySaved(payload.item as TravelerSummary);
        if (pendingPhoto) await uploadPhoto(selectedId, pendingPhoto);
        // Risk or status may have moved between stat tiles.
        await refresh();
        setFormOpen(false);
        return;
      } else {
        const res = await fetch('/api/travelers', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok || !payload?.item) {
          setError(payload?.error ?? 'Could not add the traveller.');
          setBusy(false);
          return;
        }
        if (pendingPhoto) await uploadPhoto(payload.item.id, pendingPhoto);
      }
      await refresh();
      setFormOpen(false);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    if (!window.confirm('Delete this traveller? This cannot be undone.')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/travelers/${id}`, { method: 'DELETE', credentials: 'include' });
      if (res.ok) {
        closeDetail();
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-10">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Travellers</h1>
            <p className="text-gray-500 mt-1 text-sm">The people we protect — principals, family and accompanying guests.</p>
          </div>
          {isAdmin && (
            <button onClick={openCreate} className="self-start md:self-auto inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm transition-colors hover:opacity-95" style={{ backgroundColor: BRAND }}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add traveller
            </button>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          {statTiles.map((s) => (
            <div key={s.label} className="bg-white p-4 rounded-2xl border border-gray-100">
              <p className="text-xs text-gray-400 mb-1">{s.label}</p>
              <p className="text-xl font-semibold text-gray-900">{s.value}</p>
            </div>
          ))}
        </div>

        {error && !formOpen && (
          <div className="mb-5 px-4 py-3 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-700 flex items-center justify-between gap-3">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-600 text-xs font-semibold">Dismiss</button>
          </div>
        )}

        {/* Search + filters */}
        <div className="flex flex-col lg:flex-row lg:items-center gap-3 mb-5">
          <div className="relative flex-1">
            <svg className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input type="text" placeholder="Search by name, client or nationality…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#03458f]/30" />
          </div>
          <select value={riskFilter} onChange={(e) => setRiskFilter(e.target.value)} className="px-3.5 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#03458f]/30">
            <option value="All">All risk levels</option>
            {RISK_LEVELS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3.5 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#03458f]/30">
            <option value="All">All statuses</option>
            {TRAVELER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {/* Grid */}
        {items.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-gray-200" aria-busy={listLoading}>
            <p className="text-gray-900 font-medium">
              {listLoading ? 'Searching…' : stats.total === 0 ? 'No travellers yet' : 'No matching travellers'}
            </p>
            <p className="text-gray-500 text-sm mt-1">
              {listLoading
                ? ''
                : stats.total === 0
                  ? (isAdmin ? 'Add the first person you are protecting.' : 'No travellers have been added yet.')
                  : 'Try a different search or filter.'}
            </p>
          </div>
        ) : (
          <div className={`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 transition-opacity ${listLoading ? 'opacity-60' : ''}`} aria-busy={listLoading}>
            {items.map((t) => {
              const passportDays = daysUntil(t.passportExpiry);
              return (
                <button key={t.id} onClick={() => setSelectedId(t.id)} className="text-left bg-white rounded-2xl p-5 border border-gray-100 hover:border-[#03458f]/40 hover:shadow-sm transition-all">
                  <div className="flex items-start gap-4">
                    <Avatar name={t.name} src={t.hasPhoto ? photoUrl(t) : null} size={48} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold text-gray-900 truncate">{t.name}</p>
                        <span className={`px-2 py-0.5 rounded-md text-xs border shrink-0 ${RISK_TONE[t.riskLevel] ?? RISK_TONE.Standard}`}>{t.riskLevel}</span>
                      </div>
                      <p className="text-sm text-gray-500 truncate mt-0.5">
                        {t.customer ? (t.customer.company || t.customer.name) : 'No client linked'}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-gray-400">
                        {t.nationality && <span className="px-2 py-0.5 bg-gray-50 rounded-md border border-gray-100">{t.nationality}</span>}
                        <span className="px-2 py-0.5 bg-gray-50 rounded-md border border-gray-100">{t.tripCount} trip{t.tripCount === 1 ? '' : 's'}</span>
                        {t.status !== 'Active' && <span className="px-2 py-0.5 bg-gray-50 rounded-md border border-gray-100">{t.status}</span>}
                      </div>
                      {passportDays !== null && passportDays <= 180 && (
                        <p className={`mt-2 inline-flex items-center px-2 py-0.5 rounded-md text-xs border ${passportDays < 0 ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                          {passportDays < 0 ? 'Passport expired' : `Passport expires in ${passportDays}d`}
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
        <ShowMoreButton hiddenCount={hiddenCount} onShowMore={() => void showMore()} noun="travellers" />
      </div>

      {/* Detail drawer */}
      {selectedId !== null && (
        <>
          <div className="fixed inset-0 bg-gray-900/20 backdrop-blur-sm z-[220]" onClick={closeDetail} />
          <div className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-[230] overflow-y-auto flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
              <h2 className="text-lg font-semibold text-gray-900">Traveller details</h2>
              <button onClick={closeDetail} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-50">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {detailLoading && (
              <div className="p-6 animate-pulse space-y-4" aria-busy="true">
                <div className="flex items-center gap-4">
                  <div className="h-16 w-16 rounded-xl bg-gray-100" />
                  <div className="space-y-2">
                    <div className="h-5 w-40 rounded bg-gray-100" />
                    <div className="h-4 w-28 rounded bg-gray-100" />
                  </div>
                </div>
                {Array.from({ length: 6 }, (_, i) => (
                  <div key={i} className="h-4 w-full rounded bg-gray-100" />
                ))}
                <span className="sr-only">Loading…</span>
              </div>
            )}
            {detailError && (
              <div className="m-6 px-4 py-3 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-700">{detailError}</div>
            )}

            {selected && (
            <div className="p-6 flex-1 space-y-6">
              <div className="flex items-center gap-4">
                <Avatar name={selected.name} src={selected.hasPhoto ? photoUrl(selected) : null} size={64} />
                <div className="min-w-0">
                  <h3 className="text-xl font-semibold text-gray-900 truncate">{selected.name}</h3>
                  <p className="text-sm text-gray-500 truncate">
                    {selected.customer ? (selected.customer.company || selected.customer.name) : 'No client linked'}
                  </p>
                  <span className={`inline-flex mt-1 px-2 py-0.5 rounded-md text-xs border ${RISK_TONE[selected.riskLevel] ?? RISK_TONE.Standard}`}>
                    {selected.riskLevel} risk · {selected.status}
                  </span>
                </div>
              </div>

              <div className="space-y-1">
                <Row label="Email" value={selected.email} href={selected.email ? `mailto:${selected.email}` : null} />
                <Row label="Phone" value={selected.phone} href={selected.phone ? `tel:${selected.phone}` : null} />
                <Row label="Nationality" value={selected.nationality} />
                <Row label="Date of birth" value={selected.dateOfBirth ? formatDate(selected.dateOfBirth) : null} />
                <Row label="Passport" value={selected.passportNumber} />
                <Row label="Passport expires" value={selected.passportExpiry ? formatDate(selected.passportExpiry) : null} />
                <Row label="Trips" value={String(selected.tripCount)} />
              </div>

              <div className="space-y-1">
                <Row label="Next of kin" value={selected.emergencyContactName} />
                <Row label="Next of kin phone" value={selected.emergencyContactPhone} href={selected.emergencyContactPhone ? `tel:${selected.emergencyContactPhone}` : null} />
              </div>

              {selected.medicalNotes && (
                <div>
                  <p className="text-xs text-gray-400 mb-1.5">Medical</p>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{selected.medicalNotes}</p>
                </div>
              )}
              {selected.dietaryNotes && (
                <div>
                  <p className="text-xs text-gray-400 mb-1.5">Dietary</p>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{selected.dietaryNotes}</p>
                </div>
              )}
              {selected.notes && (
                <div>
                  <p className="text-xs text-gray-400 mb-1.5">Notes</p>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{selected.notes}</p>
                </div>
              )}
            </div>
            )}

            {isAdmin && selected && (
              <div className="p-6 border-t border-gray-100 sticky bottom-0 bg-white flex gap-3">
                <button onClick={() => remove(selected.id)} disabled={busy} className="px-4 py-2.5 rounded-xl border border-rose-200 text-sm font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50">
                  Delete
                </button>
                <button onClick={() => openEdit(selected)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm" style={{ backgroundColor: BRAND }}>
                  Edit
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Create / Edit modal */}
      {formOpen && (
        <div className="fixed inset-0 z-[240] flex items-center justify-center p-4 bg-gray-900/30 backdrop-blur-sm">
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-xl max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl z-10">
              <h2 className="text-lg font-semibold text-gray-900">{editing ? 'Edit traveller' : 'Add traveller'}</h2>
              <button onClick={() => setFormOpen(false)} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-50">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={submitForm} className="p-6 space-y-4">
              {error && <div className="px-4 py-3 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-700">{error}</div>}

              <PhotoPicker preview={photoPreview} existingUrl={editing && selected?.hasPhoto ? photoUrl(selected) : null} onPick={pickPhoto} />

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Name *</Label>
                  <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Full name" autoFocus />
                </div>
                <div>
                  <Label>Client account</Label>
                  <select className={inputClass} value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })}>
                    <option value="">No client linked</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>{c.company ? `${c.name} — ${c.company}` : c.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Risk level</Label>
                  <select className={inputClass} value={form.riskLevel} onChange={(e) => setForm({ ...form, riskLevel: e.target.value })}>
                    {RISK_LEVELS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <Label>Status</Label>
                  <select className={inputClass} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                    {TRAVELER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Email</Label>
                  <input type="email" className={inputClass} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@example.com" />
                </div>
                <div>
                  <Label>Phone</Label>
                  <input className={inputClass} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+254 …" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Nationality</Label>
                  <input className={inputClass} value={form.nationality} onChange={(e) => setForm({ ...form, nationality: e.target.value })} placeholder="e.g. British" />
                </div>
                <div>
                  <Label>Date of birth</Label>
                  <input type="date" className={inputClass} value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Passport number</Label>
                  <input className={inputClass} value={form.passportNumber} onChange={(e) => setForm({ ...form, passportNumber: e.target.value })} />
                </div>
                <div>
                  <Label>Passport expires</Label>
                  <input type="date" className={inputClass} value={form.passportExpiry} onChange={(e) => setForm({ ...form, passportExpiry: e.target.value })} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Next of kin</Label>
                  <input className={inputClass} value={form.emergencyContactName} onChange={(e) => setForm({ ...form, emergencyContactName: e.target.value })} placeholder="Name" />
                </div>
                <div>
                  <Label>Next of kin phone</Label>
                  <input className={inputClass} value={form.emergencyContactPhone} onChange={(e) => setForm({ ...form, emergencyContactPhone: e.target.value })} placeholder="+254 …" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Medical notes</Label>
                  <textarea rows={2} className={`${inputClass} resize-none`} value={form.medicalNotes} onChange={(e) => setForm({ ...form, medicalNotes: e.target.value })} placeholder="Allergies, conditions, medication" />
                </div>
                <div>
                  <Label>Dietary notes</Label>
                  <textarea rows={2} className={`${inputClass} resize-none`} value={form.dietaryNotes} onChange={(e) => setForm({ ...form, dietaryNotes: e.target.value })} placeholder="Requirements or preferences" />
                </div>
              </div>

              <div>
                <Label>Notes</Label>
                <textarea rows={2} className={`${inputClass} resize-none`} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Optional" />
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setFormOpen(false)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={busy} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm disabled:opacity-50" style={{ backgroundColor: BRAND }}>
                  {busy ? 'Saving…' : editing ? 'Save changes' : 'Add traveller'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="text-xs font-medium text-gray-500 mb-1.5 block">{children}</label>;
}

function Row({ label, value, href }: { label: string; value: string | null; href?: string | null }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-400">{label}</span>
      {value ? (
        href ? (
          <a href={href} className="text-sm font-medium text-[#03458f] hover:underline truncate">{value}</a>
        ) : (
          <span className="text-sm font-medium text-gray-900 truncate">{value}</span>
        )
      ) : (
        <span className="text-sm text-gray-300">—</span>
      )}
    </div>
  );
}

function Avatar({ name, src, size }: { name: string; src: string | null; size: number }) {
  const dim = { width: size, height: size };
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={name} className="rounded-xl object-cover shrink-0" style={dim} />;
  }
  return (
    <div className="flex items-center justify-center rounded-xl text-white font-semibold shrink-0" style={{ ...dim, backgroundColor: avatarTint(name), fontSize: size / 2.8 }}>
      {initials(name)}
    </div>
  );
}

function PhotoPicker({ preview, existingUrl, onPick }: { preview: string | null; existingUrl: string | null; onPick: (file: File | null) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const shown = preview ?? existingUrl;
  return (
    <div className="flex items-center gap-4">
      <button type="button" onClick={() => inputRef.current?.click()} className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-gray-300 bg-gray-50 text-gray-400 hover:border-[#03458f]/50 hover:text-[#03458f]">
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shown} alt="" className="h-full w-full object-cover" />
        ) : (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        )}
      </button>
      <div>
        <button type="button" onClick={() => inputRef.current?.click()} className="text-sm font-semibold text-[#03458f] hover:underline">
          {shown ? 'Change photo' : 'Add photo'}
        </button>
        {shown && (
          <button type="button" onClick={() => onPick(null)} className="block text-xs text-gray-400 hover:text-gray-600 mt-1">Remove selection</button>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
    </div>
  );
}
