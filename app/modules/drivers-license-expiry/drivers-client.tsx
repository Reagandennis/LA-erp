'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

// --- Types (mirror lib/drivers.ts) ---
type LicenseStatus = 'Valid' | 'Expiring Soon' | 'Expired';
type LicenseFilter = 'All' | LicenseStatus;

type DriverLicense = {
  id: number;
  driverName: string;
  licenseNumber: string;
  category: string;
  expiryDate: string;
  lastVerified: string | null;
  notes: string | null;
  status: LicenseStatus;
  daysRemaining: number;
  hasDocument: boolean;
  document: { name: string; mime: string; size: number } | null;
  createdAt: string;
};

type Stats = { total: number; expired: number; expiringSoon: number; valid: number };

type Props = {
  isAdmin: boolean;
  initialItems: DriverLicense[];
  initialStats: Stats;
};

const BRAND = '#03458f';
const FILTER_OPTIONS: LicenseFilter[] = ['All', 'Valid', 'Expiring Soon', 'Expired'];
const CATEGORY_OPTIONS = ['Class A', 'Class B', 'Class C', 'Commercial', 'Special'] as const;

const inputClass =
  'w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#03458f]/30 focus:border-[#03458f]/40';

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Restrained, brand-aligned avatar tints (no off-brand emerald/pink/orange).
const AVATAR_TINTS = ['#03458f', '#2563eb', '#0891b2', '#6366f1', '#475569', '#0284c7'];
function avatarTint(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_TINTS[Math.abs(hash) % AVATAR_TINTS.length];
}

function getStatusStyle(status: LicenseStatus) {
  switch (status) {
    case 'Valid': return 'bg-green-50 text-green-700 border-green-100';
    case 'Expiring Soon': return 'bg-amber-50 text-amber-700 border-amber-100';
    case 'Expired': return 'bg-rose-50 text-rose-700 border-rose-100';
  }
}

function statusDot(status: LicenseStatus) {
  switch (status) {
    case 'Valid': return 'bg-green-500';
    case 'Expiring Soon': return 'bg-amber-500';
    case 'Expired': return 'bg-rose-500';
  }
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
}

function toDateInput(iso: string | null) {
  if (!iso) return '';
  return new Date(iso).toISOString().slice(0, 10);
}

export default function DriversClient({ isAdmin, initialItems, initialStats }: Props) {
  const [items, setItems] = useState<DriverLicense[]>(initialItems);
  const [stats, setStats] = useState<Stats>(initialStats);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<LicenseFilter>('All');

  // Add Driver modal
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [form, setForm] = useState({
    driverName: '',
    licenseNumber: '',
    category: 'Class A',
    expiryDate: '',
    lastVerified: '',
    notes: '',
  });
  const [addFile, setAddFile] = useState<File | null>(null);

  // Drawer editing
  const [notesDraft, setNotesDraft] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [isRenewOpen, setIsRenewOpen] = useState(false);
  const [renewDate, setRenewDate] = useState('');
  const [busy, setBusy] = useState(false);

  const drawerFileRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(() => items.find((i) => i.id === selectedId) ?? null, [items, selectedId]);

  useEffect(() => {
    setNotesDraft(selected?.notes ?? '');
    setIsRenewOpen(false);
    setRenewDate(selected ? toDateInput(selected.expiryDate) : '');
  }, [selectedId, selected]);

  const reload = async () => {
    try {
      const res = await fetch('/api/drivers', { credentials: 'include' });
      if (!res.ok) return;
      const data = (await res.json()) as { items?: DriverLicense[]; stats?: Stats };
      if (data.items) setItems(data.items);
      if (data.stats) setStats(data.stats);
    } catch {
      // ignore
    }
  };

  const filtered = items.filter((lic) => {
    const matchesSearch =
      lic.driverName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      lic.licenseNumber.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = activeFilter === 'All' || lic.status === activeFilter;
    return matchesSearch && matchesFilter;
  });

  const handleAdd = async () => {
    if (adding) return;
    if (!form.driverName.trim() || !form.licenseNumber.trim() || !form.expiryDate) {
      setAddError('Driver name, license number and expiry date are required.');
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const fd = new FormData();
      fd.append('driverName', form.driverName);
      fd.append('licenseNumber', form.licenseNumber);
      fd.append('category', form.category);
      fd.append('expiryDate', form.expiryDate);
      if (form.lastVerified) fd.append('lastVerified', form.lastVerified);
      if (form.notes) fd.append('notes', form.notes);
      if (addFile) fd.append('document', addFile);

      const res = await fetch('/api/drivers', { method: 'POST', credentials: 'include', body: fd });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setAddError(data?.error ?? 'Could not add driver.');
        return;
      }
      await reload();
      setIsAddOpen(false);
      setForm({ driverName: '', licenseNumber: '', category: 'Class A', expiryDate: '', lastVerified: '', notes: '' });
      setAddFile(null);
    } catch {
      setAddError('Could not add driver.');
    } finally {
      setAdding(false);
    }
  };

  const uploadDocument = async (licenseId: number, file: File) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('document', file);
      const res = await fetch(`/api/drivers/${licenseId}/document`, {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      if (res.ok) await reload();
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  };

  const handleHeaderUploadClick = () => {
    if (selected) {
      drawerFileRef.current?.click();
    } else if (isAdmin) {
      setIsAddOpen(true);
    }
  };

  const handleSaveNotes = async () => {
    if (!selected || savingNotes) return;
    setSavingNotes(true);
    try {
      const res = await fetch(`/api/drivers/${selected.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: notesDraft }),
      });
      if (res.ok) await reload();
    } catch {
      // ignore
    } finally {
      setSavingNotes(false);
    }
  };

  const handleRenew = async () => {
    if (!selected || !renewDate || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/drivers/${selected.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiryDate: renewDate, lastVerified: new Date().toISOString() }),
      });
      if (res.ok) {
        await reload();
        setIsRenewOpen(false);
      }
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!selected || busy) return;
    if (!window.confirm(`Remove ${selected.driverName} from the registry?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/drivers/${selected.id}`, { method: 'DELETE', credentials: 'include' });
      if (res.ok) {
        setSelectedId(null);
        await reload();
      }
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  };

  const statCards = [
    { label: 'Total drivers', count: stats.total, color: 'text-gray-900' },
    { label: 'Expired', count: stats.expired, color: 'text-rose-600' },
    { label: 'Expiring soon', count: stats.expiringSoon, color: 'text-amber-600' },
    { label: 'Valid licenses', count: stats.valid, color: 'text-green-700' },
  ];

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-10">
      {/* Hidden input for in-drawer document upload/replace */}
      <input
        ref={drawerFileRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && selected) void uploadDocument(selected.id, file);
          e.target.value = '';
        }}
      />

      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">License Compliance</h1>
            <p className="text-gray-500 mt-1 text-sm">Track driver licensing expiry and renewal schedules.</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleHeaderUploadClick}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-xl font-semibold text-sm hover:bg-gray-50 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Upload doc
            </button>
            {isAdmin && (
              <button
                onClick={() => setIsAddOpen(true)}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm transition-colors hover:opacity-95"
                style={{ backgroundColor: BRAND }}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add driver
              </button>
            )}
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          {statCards.map((stat, i) => (
            <div key={i} className="bg-white p-4 rounded-2xl border border-gray-100">
              <p className="text-xs text-gray-400 mb-1">{stat.label}</p>
              <p className={`text-xl font-semibold ${stat.color}`}>{stat.count}</p>
            </div>
          ))}
        </div>

        {/* Toolbar */}
        <div className="flex flex-col lg:flex-row lg:items-center gap-3 mb-5">
          <div className="relative flex-1">
            <svg className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search driver name or license number…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#03458f]/30 text-sm"
            />
          </div>
          <div className="flex items-center gap-1 bg-white border border-gray-100 rounded-xl p-1 overflow-x-auto">
            {FILTER_OPTIONS.map((status) => (
              <button
                key={status}
                onClick={() => setActiveFilter(status)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                  activeFilter === status ? 'text-white' : 'text-gray-500 hover:bg-gray-50'
                }`}
                style={activeFilter === status ? { backgroundColor: BRAND } : undefined}
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        {/* License Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((lic) => (
            <button
              key={lic.id}
              onClick={() => setSelectedId(lic.id)}
              className="text-left bg-white rounded-2xl p-5 border border-gray-100 hover:border-[#03458f]/40 hover:shadow-sm transition-all"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center text-white font-semibold shrink-0"
                    style={{ backgroundColor: avatarTint(lic.driverName) }}
                  >
                    {initials(lic.driverName)}
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-semibold text-gray-900 leading-tight truncate">{lic.driverName}</h3>
                    <p className="text-xs text-gray-400 mt-0.5">{lic.category}</p>
                  </div>
                </div>
                <span className={`px-2 py-0.5 rounded-md text-xs font-medium border shrink-0 ${getStatusStyle(lic.status)}`}>
                  {lic.status}
                </span>
              </div>

              <div className="space-y-2 mb-4">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-xs text-gray-400">License no.</span>
                  <span className="font-medium text-gray-900">{lic.licenseNumber}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-xs text-gray-400">Expiry date</span>
                  <span className={`font-medium ${lic.status === 'Expired' ? 'text-rose-600' : 'text-gray-900'}`}>{formatDate(lic.expiryDate)}</span>
                </div>
              </div>

              <div className="pt-3 border-t border-gray-50">
                <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${
                  lic.daysRemaining < 0 ? 'text-rose-600' : lic.daysRemaining < 30 ? 'text-amber-600' : 'text-green-700'
                }`}>
                  <span className={`w-2 h-2 rounded-full ${statusDot(lic.status)}`} />
                  {lic.daysRemaining < 0 ? `Expired ${Math.abs(lic.daysRemaining)} days ago` : `${lic.daysRemaining} days left`}
                </span>
              </div>
            </button>
          ))}
        </div>

        {/* Empty State */}
        {filtered.length === 0 && (
          <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-gray-200">
            <h3 className="text-gray-900 font-medium">{items.length === 0 ? 'No drivers yet' : 'No matching records'}</h3>
            <p className="text-gray-500 text-sm mt-1">
              {items.length === 0
                ? isAdmin
                  ? 'Add a driver to start tracking license compliance.'
                  : 'No drivers have been added to the registry yet.'
                : 'Try adjusting your search or status filter.'}
            </p>
          </div>
        )}
      </div>

      {/* Detail Viewer Drawer */}
      {selected && (
        <>
          <div className="fixed inset-0 bg-gray-900/20 backdrop-blur-sm z-40" onClick={() => setSelectedId(null)} />
          <div className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 overflow-y-auto flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
              <h2 className="text-lg font-semibold text-gray-900">Driver details</h2>
              <button onClick={() => setSelectedId(null)} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-50">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 flex-1 space-y-7">
              {/* Identity */}
              <div className="flex items-center gap-4">
                <div className="relative shrink-0">
                  <div
                    className="w-16 h-16 rounded-2xl flex items-center justify-center text-white font-semibold text-xl"
                    style={{ backgroundColor: avatarTint(selected.driverName) }}
                  >
                    {initials(selected.driverName)}
                  </div>
                  <span className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full border-2 border-white ${statusDot(selected.status)}`} />
                </div>
                <div className="min-w-0">
                  <h3 className="text-xl font-semibold text-gray-900 truncate">{selected.driverName}</h3>
                  <p className="text-sm text-gray-500">{selected.category} operator</p>
                </div>
              </div>

              {/* Detailed Specs */}
              <div className="grid grid-cols-2 gap-3">
                <Meta label="License number" value={selected.licenseNumber} />
                <Meta label="Expiration" value={formatDate(selected.expiryDate)} warn={selected.status === 'Expired'} />
                <Meta label="Last verified" value={formatDate(selected.lastVerified)} />
                <Meta
                  label="Compliance"
                  value={selected.status === 'Valid' ? 'In order' : 'Requires action'}
                  warn={selected.status !== 'Valid'}
                  good={selected.status === 'Valid'}
                />
              </div>

              {/* Notes (editable) */}
              <div>
                <h4 className="text-sm font-semibold text-gray-900 mb-2">Admin notes</h4>
                <textarea
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  rows={3}
                  placeholder="Add administrative notes for this driver's license…"
                  className={`${inputClass} resize-none`}
                />
                {notesDraft !== (selected.notes ?? '') && (
                  <button
                    onClick={handleSaveNotes}
                    disabled={savingNotes}
                    className="mt-2 px-4 py-2 rounded-xl text-xs font-semibold text-white transition-colors disabled:opacity-60"
                    style={{ backgroundColor: BRAND }}
                  >
                    {savingNotes ? 'Saving…' : 'Save notes'}
                  </button>
                )}
              </div>

              {/* Document */}
              <div>
                <h4 className="text-sm font-semibold text-gray-900 mb-2">License document</h4>
                {selected.hasDocument ? (
                  <div className="p-5 border border-gray-100 rounded-2xl flex flex-col items-center justify-center text-center bg-gray-50">
                    <svg className="w-10 h-10 mb-2" style={{ color: BRAND }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <p className="text-xs font-medium text-gray-600 break-all px-2">{selected.document?.name}</p>
                    <div className="flex items-center gap-4 mt-3">
                      <a
                        href={`/api/drivers/${selected.id}/document`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-semibold text-[#03458f] hover:underline"
                      >
                        View document
                      </a>
                      <button
                        onClick={() => drawerFileRef.current?.click()}
                        disabled={busy}
                        className="text-xs font-semibold text-gray-400 hover:text-gray-600 disabled:opacity-60"
                      >
                        Replace
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => drawerFileRef.current?.click()}
                    disabled={busy}
                    className="w-full p-6 border border-dashed border-gray-200 rounded-2xl flex flex-col items-center justify-center text-center hover:border-[#03458f]/50 transition-colors disabled:opacity-60"
                  >
                    <svg className="w-9 h-9 text-gray-300 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    <p className="text-xs font-medium text-gray-400">{busy ? 'Uploading…' : 'Upload license scan (PDF / image)'}</p>
                  </button>
                )}
              </div>

              {/* Renewal editor */}
              {isRenewOpen && (
                <div className="p-5 bg-gray-50 rounded-2xl border border-gray-100">
                  <label className="text-xs font-medium text-gray-500 mb-1.5 block">New expiry date</label>
                  <input
                    type="date"
                    value={renewDate}
                    onChange={(e) => setRenewDate(e.target.value)}
                    className={`${inputClass} mb-3 bg-white`}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleRenew}
                      disabled={busy || !renewDate}
                      className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-white transition-colors disabled:opacity-60"
                      style={{ backgroundColor: BRAND }}
                    >
                      {busy ? 'Saving…' : 'Confirm renewal'}
                    </button>
                    <button onClick={() => setIsRenewOpen(false)} className="px-4 py-2.5 text-gray-500 text-xs font-semibold hover:text-gray-700">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="p-6 border-t border-gray-100 sticky bottom-0 bg-white flex flex-col gap-2">
              <button
                onClick={() => setIsRenewOpen((v) => !v)}
                className="w-full py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm transition-colors"
                style={{ backgroundColor: BRAND }}
              >
                Update renewal
              </button>
              {isAdmin && (
                <button onClick={handleDelete} disabled={busy} className="w-full py-2.5 text-rose-500 font-semibold text-sm hover:text-rose-600 transition-colors disabled:opacity-60">
                  Remove driver
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {/* Add Driver Modal */}
      {isAddOpen && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-gray-900/30 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl overflow-hidden max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white">
              <h2 className="text-lg font-semibold text-gray-900">Add driver</h2>
              <button onClick={() => setIsAddOpen(false)} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-50">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <Label>Driver name</Label>
                <input
                  type="text"
                  value={form.driverName}
                  onChange={(e) => setForm({ ...form, driverName: e.target.value })}
                  placeholder="Full name"
                  className={inputClass}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>License number</Label>
                  <input
                    type="text"
                    value={form.licenseNumber}
                    onChange={(e) => setForm({ ...form, licenseNumber: e.target.value })}
                    placeholder="DL-00000-XX"
                    className={inputClass}
                  />
                </div>
                <div>
                  <Label>Category</Label>
                  <select
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    className={inputClass}
                  >
                    {CATEGORY_OPTIONS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Expiry date</Label>
                  <input
                    type="date"
                    value={form.expiryDate}
                    onChange={(e) => setForm({ ...form, expiryDate: e.target.value })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <Label>Last verified</Label>
                  <input
                    type="date"
                    value={form.lastVerified}
                    onChange={(e) => setForm({ ...form, lastVerified: e.target.value })}
                    className={inputClass}
                  />
                </div>
              </div>
              <div>
                <Label>Notes (optional)</Label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={2}
                  placeholder="Any relevant notes…"
                  className={`${inputClass} resize-none`}
                />
              </div>
              <div>
                <Label>License document (optional)</Label>
                <input
                  type="file"
                  onChange={(e) => setAddFile(e.target.files?.[0] ?? null)}
                  className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-[#03458f] hover:file:bg-blue-100"
                />
                {addFile && <p className="text-xs text-gray-400 mt-1">{addFile.name}</p>}
              </div>
              {addError && <p className="text-xs text-rose-600">{addError}</p>}
              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => setIsAddOpen(false)}
                  className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAdd}
                  disabled={adding}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm transition-colors disabled:opacity-60"
                  style={{ backgroundColor: BRAND }}
                >
                  {adding ? 'Adding…' : 'Add driver'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="text-xs font-medium text-gray-500 mb-1.5 block">{children}</label>;
}

function Meta({ label, value, warn, good }: { label: string; value: string; warn?: boolean; good?: boolean }) {
  const color = warn ? 'text-rose-600' : good ? 'text-green-700' : 'text-gray-900';
  return (
    <div className="bg-gray-50 rounded-xl border border-gray-100 p-3.5">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className={`text-sm font-medium ${color}`}>{value}</p>
    </div>
  );
}
