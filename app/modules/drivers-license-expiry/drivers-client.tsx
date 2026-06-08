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

const FILTER_OPTIONS: LicenseFilter[] = ['All', 'Valid', 'Expiring Soon', 'Expired'];
const CATEGORY_OPTIONS = ['Class A', 'Class B', 'Class C', 'Commercial', 'Special'] as const;

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getAvatarColor(name: string) {
  const colors = ['bg-blue-500', 'bg-emerald-500', 'bg-purple-500', 'bg-orange-500', 'bg-pink-500', 'bg-indigo-500'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function getStatusStyle(status: LicenseStatus) {
  switch (status) {
    case 'Valid': return 'bg-emerald-50 text-emerald-600 border-emerald-100';
    case 'Expiring Soon': return 'bg-amber-50 text-amber-600 border-amber-100';
    case 'Expired': return 'bg-rose-50 text-rose-600 border-rose-100';
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
    { label: 'Total Drivers', count: stats.total, color: 'text-gray-900' },
    { label: 'Expired', count: stats.expired, color: 'text-rose-600' },
    { label: 'Expiring Soon', count: stats.expiringSoon, color: 'text-amber-600' },
    { label: 'Valid Licenses', count: stats.valid, color: 'text-emerald-600' },
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

      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 tracking-tight">License Compliance</h1>
            <p className="text-gray-500 mt-1 font-medium">Track driver licensing expiry and renewal schedules</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleHeaderUploadClick}
              className="px-6 py-3 bg-white border border-gray-200 text-gray-700 rounded-2xl font-bold text-sm hover:bg-gray-50 transition-all shadow-sm flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Upload Doc
            </button>
            {isAdmin && (
              <button
                onClick={() => setIsAddOpen(true)}
                className="px-6 py-3 bg-emerald-600 text-white rounded-2xl font-bold text-sm hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200 flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Driver
              </button>
            )}
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {statCards.map((stat, i) => (
            <div key={i} className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm">
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{stat.label}</p>
              <p className={`text-2xl font-black ${stat.color}`}>{stat.count}</p>
            </div>
          ))}
        </div>

        {/* Toolbar */}
        <div className="bg-white p-4 rounded-3xl border border-gray-100 shadow-sm mb-8 flex flex-col lg:flex-row lg:items-center gap-4">
          <div className="relative flex-1">
            <svg className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search driver name or license number..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border-none rounded-xl focus:ring-2 focus:ring-emerald-500 text-sm font-medium"
            />
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {FILTER_OPTIONS.map((status) => (
              <button
                key={status}
                onClick={() => setActiveFilter(status)}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                  activeFilter === status ? 'bg-emerald-50 text-emerald-700 shadow-sm' : 'text-gray-500 hover:bg-gray-50'
                }`}
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        {/* License Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filtered.map((lic) => (
            <div
              key={lic.id}
              onClick={() => setSelectedId(lic.id)}
              className="group bg-white rounded-[2.5rem] p-8 border border-gray-100 hover:border-emerald-300 hover:shadow-2xl hover:shadow-emerald-500/5 transition-all duration-300 cursor-pointer relative overflow-hidden"
            >
              <div className="flex items-start justify-between mb-6">
                <div className="flex items-center gap-4">
                  <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-white font-bold text-xl shadow-lg transition-transform group-hover:scale-105 ${getAvatarColor(lic.driverName)}`}>
                    {initials(lic.driverName)}
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-gray-900 leading-tight">{lic.driverName}</h3>
                    <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mt-1">{lic.category}</p>
                  </div>
                </div>
                <div className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border ${getStatusStyle(lic.status)}`}>
                  {lic.status}
                </div>
              </div>

              <div className="space-y-4 mb-8">
                <div className="flex justify-between items-center p-3 bg-gray-50 rounded-2xl">
                  <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">License No</span>
                  <span className="text-sm font-bold text-gray-900">{lic.licenseNumber}</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-gray-50 rounded-2xl">
                  <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Expiry Date</span>
                  <span className={`text-sm font-bold ${lic.status === 'Expired' ? 'text-rose-600' : 'text-gray-900'}`}>{formatDate(lic.expiryDate)}</span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-6 border-t border-gray-50">
                <div className="flex flex-col">
                  <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">Time Remaining</span>
                  <span className={`text-sm font-black ${
                    lic.daysRemaining < 0 ? 'text-rose-600' : lic.daysRemaining < 30 ? 'text-amber-600' : 'text-emerald-600'
                  }`}>
                    {lic.daysRemaining < 0 ? `Expired ${Math.abs(lic.daysRemaining)} days ago` : `${lic.daysRemaining} Days Left`}
                  </span>
                </div>
                <div className="p-3 bg-gray-900 text-white rounded-xl shadow-lg shadow-gray-200">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Empty State */}
        {filtered.length === 0 && (
          <div className="text-center py-20 bg-white rounded-[3rem] border border-dashed border-gray-200">
            <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4 text-gray-300">
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-gray-900">{items.length === 0 ? 'No drivers yet' : 'No matching records'}</h3>
            <p className="text-gray-500 mt-1">
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
          <div className="fixed inset-0 bg-gray-900/10 backdrop-blur-sm z-40 transition-opacity" onClick={() => setSelectedId(null)} />
          <div className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 overflow-y-auto animate-in slide-in-from-right duration-500 ease-out flex flex-col">
            <div className="p-8 pb-0">
              <div className="flex justify-end mb-4">
                <button onClick={() => setSelectedId(null)} className="p-2 bg-gray-50 hover:bg-gray-100 rounded-xl text-gray-400 hover:text-gray-600 transition-all">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="flex flex-col items-center text-center">
                <div className="relative mb-6">
                  <div className={`w-32 h-32 rounded-[2.5rem] flex items-center justify-center text-white font-bold text-4xl shadow-2xl ${getAvatarColor(selected.driverName)}`}>
                    {initials(selected.driverName)}
                  </div>
                  <div className={`absolute bottom-2 right-2 w-8 h-8 rounded-full border-4 border-white ${
                    selected.status === 'Valid' ? 'bg-emerald-500' : selected.status === 'Expiring Soon' ? 'bg-amber-500' : 'bg-rose-500'
                  }`} />
                </div>
                <h2 className="text-3xl font-black text-gray-900 mb-1">{selected.driverName}</h2>
                <p className="text-emerald-600 font-black uppercase tracking-[0.2em] text-xs mb-8">{selected.category} Operator</p>
              </div>
            </div>

            <div className="p-8 flex-1 space-y-8">
              {/* Detailed Specs */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 p-5 rounded-3xl border border-gray-100">
                  <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1 block">License Number</label>
                  <p className="text-sm font-bold text-gray-900">{selected.licenseNumber}</p>
                </div>
                <div className="bg-gray-50 p-5 rounded-3xl border border-gray-100">
                  <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1 block">Expiration</label>
                  <p className="text-sm font-bold text-gray-900">{formatDate(selected.expiryDate)}</p>
                </div>
                <div className="bg-gray-50 p-5 rounded-3xl border border-gray-100">
                  <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1 block">Last Verified</label>
                  <p className="text-sm font-bold text-gray-900">{formatDate(selected.lastVerified)}</p>
                </div>
                <div className="bg-gray-50 p-5 rounded-3xl border border-gray-100">
                  <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1 block">Compliance</label>
                  <p className={`text-sm font-bold ${selected.status === 'Valid' ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {selected.status === 'Valid' ? 'In Order' : 'Requires Action'}
                  </p>
                </div>
              </div>

              {/* Notes (editable) */}
              <div>
                <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-3">Admin Notes</h4>
                <textarea
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  rows={3}
                  placeholder="Add administrative notes for this driver's license..."
                  className="w-full p-5 bg-amber-50/50 rounded-2xl border border-amber-100 text-sm text-amber-900 font-medium leading-relaxed focus:ring-2 focus:ring-amber-400 resize-none"
                />
                {notesDraft !== (selected.notes ?? '') && (
                  <button
                    onClick={handleSaveNotes}
                    disabled={savingNotes}
                    className="mt-2 px-4 py-2 bg-amber-500 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-amber-600 transition-all disabled:opacity-60"
                  >
                    {savingNotes ? 'Saving...' : 'Save Notes'}
                  </button>
                )}
              </div>

              {/* Document */}
              <div>
                <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-3">License Document</h4>
                {selected.hasDocument ? (
                  <div className="p-6 border-2 border-gray-100 rounded-[2rem] flex flex-col items-center justify-center text-center bg-gray-50/50">
                    <svg className="w-12 h-12 text-emerald-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <p className="text-xs font-bold text-gray-600 break-all px-2">{selected.document?.name}</p>
                    <div className="flex items-center gap-4 mt-4">
                      <a
                        href={`/api/drivers/${selected.id}/document`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-black text-emerald-600 uppercase tracking-widest hover:text-emerald-700"
                      >
                        View Document
                      </a>
                      <button
                        onClick={() => drawerFileRef.current?.click()}
                        disabled={busy}
                        className="text-xs font-black text-gray-400 uppercase tracking-widest hover:text-gray-600 disabled:opacity-60"
                      >
                        Replace
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => drawerFileRef.current?.click()}
                    disabled={busy}
                    className="w-full p-8 border-2 border-dashed border-gray-200 rounded-[2rem] flex flex-col items-center justify-center text-center hover:border-emerald-300 transition-all disabled:opacity-60"
                  >
                    <svg className="w-12 h-12 text-gray-300 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    <p className="text-xs font-bold text-gray-400">{busy ? 'Uploading...' : 'Upload license scan (PDF / image)'}</p>
                  </button>
                )}
              </div>

              {/* Renewal editor */}
              {isRenewOpen && (
                <div className="p-5 bg-emerald-50/50 rounded-2xl border border-emerald-100">
                  <label className="text-[9px] font-black text-emerald-700 uppercase tracking-widest mb-2 block">New Expiry Date</label>
                  <input
                    type="date"
                    value={renewDate}
                    onChange={(e) => setRenewDate(e.target.value)}
                    className="w-full px-4 py-2.5 bg-white border border-emerald-200 rounded-xl focus:ring-2 focus:ring-emerald-500 text-sm font-bold mb-3"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleRenew}
                      disabled={busy || !renewDate}
                      className="flex-1 py-2.5 bg-emerald-600 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-emerald-700 disabled:opacity-60"
                    >
                      {busy ? 'Saving...' : 'Confirm Renewal'}
                    </button>
                    <button onClick={() => setIsRenewOpen(false)} className="px-4 py-2.5 text-gray-500 text-xs font-black uppercase tracking-widest hover:text-gray-700">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="p-8 pt-4 bg-white border-t border-gray-50 sticky bottom-0 flex flex-col gap-3">
              <button
                onClick={() => setIsRenewOpen((v) => !v)}
                className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700 transition-all shadow-xl shadow-emerald-100"
              >
                Update Renewal
              </button>
              {isAdmin && (
                <button onClick={handleDelete} disabled={busy} className="w-full py-3 text-rose-400 font-bold text-sm hover:text-rose-600 transition-all disabled:opacity-60">
                  Remove Driver
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {/* Add Driver Modal */}
      {isAddOpen && (
        <>
          <button type="button" className="fixed inset-0 z-[300] bg-gray-900/20 backdrop-blur-sm" onClick={() => setIsAddOpen(false)} aria-label="Close" />
          <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[310] w-full max-w-lg bg-white rounded-[2.5rem] shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
            <div className="p-8 pb-4 flex items-center justify-between">
              <h2 className="text-2xl font-black text-gray-900">Add Driver</h2>
              <button onClick={() => setIsAddOpen(false)} className="p-2 bg-gray-50 hover:bg-gray-100 rounded-xl text-gray-400 hover:text-gray-600">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-8 pb-8 space-y-4">
              <div>
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block">Driver Name</label>
                <input
                  type="text"
                  value={form.driverName}
                  onChange={(e) => setForm({ ...form, driverName: e.target.value })}
                  placeholder="Full name"
                  className="w-full px-4 py-3 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-emerald-500 text-sm font-bold"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block">License Number</label>
                  <input
                    type="text"
                    value={form.licenseNumber}
                    onChange={(e) => setForm({ ...form, licenseNumber: e.target.value })}
                    placeholder="DL-00000-XX"
                    className="w-full px-4 py-3 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-emerald-500 text-sm font-bold"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block">Category</label>
                  <select
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    className="w-full px-4 py-3 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-emerald-500 text-sm font-bold text-gray-600"
                  >
                    {CATEGORY_OPTIONS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block">Expiry Date</label>
                  <input
                    type="date"
                    value={form.expiryDate}
                    onChange={(e) => setForm({ ...form, expiryDate: e.target.value })}
                    className="w-full px-4 py-3 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-emerald-500 text-sm font-bold"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block">Last Verified</label>
                  <input
                    type="date"
                    value={form.lastVerified}
                    onChange={(e) => setForm({ ...form, lastVerified: e.target.value })}
                    className="w-full px-4 py-3 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-emerald-500 text-sm font-bold"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block">Notes (optional)</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={2}
                  placeholder="Any relevant notes..."
                  className="w-full px-4 py-3 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-emerald-500 text-sm font-medium resize-none"
                />
              </div>
              <div>
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block">License Document (optional)</label>
                <input
                  type="file"
                  onChange={(e) => setAddFile(e.target.files?.[0] ?? null)}
                  className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-black file:uppercase file:tracking-widest file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100"
                />
                {addFile && <p className="text-[11px] text-gray-400 mt-1 font-medium">{addFile.name}</p>}
              </div>
              {addError && <p className="text-xs font-bold text-rose-500">{addError}</p>}
              <button
                onClick={handleAdd}
                disabled={adding}
                className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700 transition-all shadow-xl shadow-emerald-100 disabled:opacity-60"
              >
                {adding ? 'Adding...' : 'Add Driver'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
