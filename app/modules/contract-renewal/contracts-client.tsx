'use client';

import { APP_LOCALE } from '@/lib/locale';
import React, { useMemo, useRef, useState } from 'react';

import type { ContractStats, ContractSummary } from '@/lib/contracts';

const BRAND = '#03458f';

const TYPES = ['Fixed Term', 'Retainer', 'Project Based'] as const;
const LIFECYCLE = ['Active', 'In Renewal', 'Renewed', 'Cancelled'] as const;
const DISPLAY_STATUSES = ['Active', 'Expiring Soon', 'In Renewal', 'Renewed', 'Expired', 'Cancelled'] as const;
const CURRENCIES = ['USD', 'EUR', 'GBP', 'KES', 'NGN', 'ZAR'] as const;

const inputClass =
  'w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#03458f]/30 focus:border-[#03458f]/40';

function statusStyle(status: string): string {
  switch (status) {
    case 'Active': return 'bg-green-50 text-green-700 border-green-100';
    case 'Expiring Soon': return 'bg-amber-50 text-amber-700 border-amber-100';
    case 'In Renewal': return 'bg-blue-50 text-blue-700 border-blue-100';
    case 'Renewed': return 'bg-indigo-50 text-indigo-700 border-indigo-100';
    case 'Expired': return 'bg-rose-50 text-rose-700 border-rose-100';
    case 'Cancelled': return 'bg-gray-100 text-gray-500 border-gray-200';
    default: return 'bg-gray-50 text-gray-500 border-gray-100';
  }
}

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
function toDateInput(iso: string | null) {
  if (!iso) return '';
  return new Date(iso).toISOString().slice(0, 10);
}
function formatMoney(value: number | null, currency: string) {
  if (value == null) return '—';
  try {
    return new Intl.NumberFormat(APP_LOCALE, { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString(APP_LOCALE)}`;
  }
}

type Props = {
  isAdmin: boolean;
  initialItems: ContractSummary[];
  initialStats: ContractStats;
};

type ContractForm = {
  reference: string;
  counterpartyName: string;
  email: string;
  department: string;
  type: string;
  status: string;
  startDate: string;
  endDate: string;
  value: string;
  currency: string;
  notes: string;
};

const EMPTY_FORM: ContractForm = {
  reference: '',
  counterpartyName: '',
  email: '',
  department: '',
  type: 'Fixed Term',
  status: 'Active',
  startDate: '',
  endDate: '',
  value: '',
  currency: 'USD',
  notes: '',
};

export default function ContractsClient({ isAdmin, initialItems, initialStats }: Props) {
  const [items, setItems] = useState<ContractSummary[]>(initialItems);
  const [stats, setStats] = useState<ContractStats>(initialStats);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('All');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ContractForm>(EMPTY_FORM);
  const [addFile, setAddFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Drawer state
  const [notesDraft, setNotesDraft] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [isRenewOpen, setIsRenewOpen] = useState(false);
  const [renewDate, setRenewDate] = useState('');
  const drawerFileRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(() => items.find((i) => i.id === selectedId) ?? null, [items, selectedId]);

  // Re-seed the drawer form whenever a different contract (or a refreshed copy
  // of it) is selected. Adjusted during render so a stale draft never paints.
  const [draftSource, setDraftSource] = useState(selected);
  if (draftSource !== selected) {
    setDraftSource(selected);
    setNotesDraft(selected?.notes ?? '');
    setIsRenewOpen(false);
    setRenewDate(selected ? toDateInput(selected.endDate) : '');
  }

  const reload = async () => {
    try {
      const res = await fetch('/api/contracts', { credentials: 'include' });
      if (!res.ok) return;
      const data = (await res.json()) as { items?: ContractSummary[]; stats?: ContractStats };
      if (data.items) setItems(data.items);
      if (data.stats) setStats(data.stats);
    } catch {
      /* ignore */
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((c) => {
      if (statusFilter !== 'All' && c.status !== statusFilter) return false;
      if (!q) return true;
      return [c.reference, c.counterpartyName, c.department, c.email]
        .filter(Boolean)
        .some((f) => String(f).toLowerCase().includes(q));
    });
  }, [items, search, statusFilter]);

  const statCards = [
    { label: 'Total contracts', value: stats.total, color: 'text-gray-900' },
    { label: 'Expiring soon', value: stats.expiringSoon, color: 'text-amber-600' },
    { label: 'In renewal', value: stats.inRenewal, color: 'text-blue-700' },
    { label: 'Expired', value: stats.expired, color: 'text-rose-600' },
  ];

  // --- Form -----------------------------------------------------------------

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setAddFile(null);
    setEditing(false);
    setError(null);
    setFormOpen(true);
  };

  const openEdit = (c: ContractSummary) => {
    setForm({
      reference: c.reference,
      counterpartyName: c.counterpartyName,
      email: c.email ?? '',
      department: c.department ?? '',
      type: c.type,
      status: c.lifecycle,
      startDate: toDateInput(c.startDate),
      endDate: toDateInput(c.endDate),
      value: c.value != null ? String(c.value) : '',
      currency: c.currency,
      notes: c.notes ?? '',
    });
    setAddFile(null);
    setEditing(true);
    setError(null);
    setFormOpen(true);
  };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.reference.trim() || !form.counterpartyName.trim() || !form.startDate || !form.endDate) {
      setError('Reference, counterparty, start and end dates are required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (editing && selectedId) {
        const res = await fetch(`/api/contracts/${selectedId}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reference: form.reference.trim(),
            counterpartyName: form.counterpartyName.trim(),
            email: form.email.trim() || null,
            department: form.department.trim() || null,
            type: form.type,
            status: form.status,
            startDate: form.startDate,
            endDate: form.endDate,
            value: form.value.trim() ? Number(form.value) : null,
            currency: form.currency,
            notes: form.notes.trim() || null,
          }),
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok) {
          setError(payload?.error ?? 'Could not update the contract.');
          setBusy(false);
          return;
        }
        if (addFile) await uploadDocument(selectedId, addFile);
      } else {
        const fd = new FormData();
        fd.append('reference', form.reference);
        fd.append('counterpartyName', form.counterpartyName);
        fd.append('email', form.email);
        fd.append('department', form.department);
        fd.append('type', form.type);
        fd.append('status', form.status);
        fd.append('startDate', form.startDate);
        fd.append('endDate', form.endDate);
        fd.append('value', form.value);
        fd.append('currency', form.currency);
        fd.append('notes', form.notes);
        if (addFile) fd.append('document', addFile);
        const res = await fetch('/api/contracts', { method: 'POST', credentials: 'include', body: fd });
        const payload = await res.json().catch(() => null);
        if (!res.ok) {
          setError(payload?.error ?? 'Could not create the contract.');
          setBusy(false);
          return;
        }
      }
      await reload();
      setFormOpen(false);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  // --- Drawer actions -------------------------------------------------------

  const uploadDocument = async (contractId: number, file: File) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('document', file);
      const res = await fetch(`/api/contracts/${contractId}/document`, { method: 'POST', credentials: 'include', body: fd });
      if (res.ok) await reload();
    } finally {
      setBusy(false);
    }
  };

  const handleSaveNotes = async () => {
    if (!selected || savingNotes) return;
    setSavingNotes(true);
    try {
      const res = await fetch(`/api/contracts/${selected.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: notesDraft }),
      });
      if (res.ok) await reload();
    } finally {
      setSavingNotes(false);
    }
  };

  const handleLifecycle = async (status: string) => {
    if (!selected || status === selected.lifecycle) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/contracts/${selected.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok) await reload();
    } finally {
      setBusy(false);
    }
  };

  const handleRenew = async () => {
    if (!selected || !renewDate || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/contracts/${selected.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endDate: renewDate, lastRenewalDate: new Date().toISOString(), status: 'Active' }),
      });
      if (res.ok) {
        await reload();
        setIsRenewOpen(false);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!selected || busy) return;
    if (!window.confirm(`Remove contract ${selected.reference}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/contracts/${selected.id}`, { method: 'DELETE', credentials: 'include' });
      if (res.ok) {
        setSelectedId(null);
        await reload();
      }
    } finally {
      setBusy(false);
    }
  };

  // --- Render ---------------------------------------------------------------

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-10">
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
            <h1 className="text-2xl font-semibold text-gray-900">Contract Renewal</h1>
            <p className="text-gray-500 mt-1 text-sm">Track contract terms, renewal windows, and upcoming actions.</p>
          </div>
          {isAdmin && (
            <button
              onClick={openCreate}
              className="self-start md:self-auto inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm transition-colors hover:opacity-95"
              style={{ backgroundColor: BRAND }}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New contract
            </button>
          )}
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

        {/* Search + filters */}
        <div className="flex flex-col lg:flex-row lg:items-center gap-3 mb-5">
          <div className="relative flex-1">
            <svg className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search reference, counterparty, department…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#03458f]/30"
            />
          </div>
          <div className="flex items-center gap-1 bg-white border border-gray-100 rounded-xl p-1 overflow-x-auto">
            {(['All', ...DISPLAY_STATUSES] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                  statusFilter === s ? 'text-white' : 'text-gray-500 hover:bg-gray-50'
                }`}
                style={statusFilter === s ? { backgroundColor: BRAND } : undefined}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Grid */}
        {filtered.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-gray-200">
            <p className="text-gray-900 font-medium">{items.length === 0 ? 'No contracts yet' : 'No matching contracts'}</p>
            <p className="text-gray-500 text-sm mt-1">
              {items.length === 0
                ? isAdmin ? 'Add a contract to start tracking renewals.' : 'No contracts have been added yet.'
                : 'Try a different search or filter.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className="text-left bg-white rounded-2xl p-5 border border-gray-100 hover:border-[#03458f]/40 hover:shadow-sm transition-all"
              >
                <div className="flex items-start justify-between gap-2 mb-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white font-semibold shrink-0" style={{ backgroundColor: avatarTint(c.counterpartyName) }}>
                      {initials(c.counterpartyName)}
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-gray-900 leading-tight truncate">{c.counterpartyName}</h3>
                      <p className="text-xs font-mono text-gray-400 mt-0.5">{c.reference}</p>
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 rounded-md text-xs font-medium border shrink-0 ${statusStyle(c.status)}`}>{c.status}</span>
                </div>

                <div className="space-y-2 mb-4">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-xs text-gray-400">End date</span>
                    <span className={`font-medium ${c.status === 'Expired' ? 'text-rose-600' : 'text-gray-900'}`}>{formatDate(c.endDate)}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-xs text-gray-400">Value</span>
                    <span className="font-medium text-gray-900">{formatMoney(c.value, c.currency)}</span>
                  </div>
                </div>

                <div className="pt-3 border-t border-gray-50 flex items-center justify-between">
                  <span className="text-xs text-gray-400">{c.type}{c.department ? ` · ${c.department}` : ''}</span>
                  <span className={`text-xs font-medium ${
                    c.daysRemaining < 0 ? 'text-rose-600' : c.daysRemaining <= 30 ? 'text-amber-600' : 'text-gray-500'
                  }`}>
                    {c.status === 'Cancelled' || c.status === 'Renewed'
                      ? c.status
                      : c.daysRemaining < 0 ? `Expired ${Math.abs(c.daysRemaining)}d ago` : `${c.daysRemaining}d left`}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Detail drawer */}
      {selected && (
        <>
          <div className="fixed inset-0 bg-gray-900/20 backdrop-blur-sm z-40" onClick={() => setSelectedId(null)} />
          <div className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 overflow-y-auto flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
              <h2 className="text-lg font-semibold text-gray-900">Contract details</h2>
              <button onClick={() => setSelectedId(null)} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-50">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 flex-1 space-y-7">
              {/* Identity */}
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-white font-semibold text-xl shrink-0" style={{ backgroundColor: avatarTint(selected.counterpartyName) }}>
                  {initials(selected.counterpartyName)}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xl font-semibold text-gray-900 truncate">{selected.counterpartyName}</h3>
                  </div>
                  <p className="text-xs font-mono text-gray-400 mt-0.5">{selected.reference}</p>
                  <span className={`inline-block mt-1.5 px-2 py-0.5 rounded-md text-xs font-medium border ${statusStyle(selected.status)}`}>{selected.status}</span>
                </div>
              </div>

              {selected.email && (
                <a href={`mailto:${selected.email}`} className="block text-sm font-medium text-[#03458f] hover:underline">{selected.email}</a>
              )}

              {/* Specs */}
              <div className="grid grid-cols-2 gap-3">
                <Meta label="Type" value={selected.type} />
                <Meta label="Department" value={selected.department ?? '—'} />
                <Meta label="Start date" value={formatDate(selected.startDate)} />
                <Meta label="End date" value={formatDate(selected.endDate)} warn={selected.status === 'Expired'} />
                <Meta label="Value" value={formatMoney(selected.value, selected.currency)} />
                <Meta label="Last renewed" value={formatDate(selected.lastRenewalDate)} />
              </div>

              {/* Lifecycle (admin) */}
              {isAdmin && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 mb-2">Lifecycle status</h4>
                  <select
                    value={selected.lifecycle}
                    onChange={(e) => handleLifecycle(e.target.value)}
                    disabled={busy}
                    className={inputClass}
                  >
                    {LIFECYCLE.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <p className="text-xs text-gray-400 mt-1.5">“Active” contracts auto-flag as Expiring Soon / Expired from the end date.</p>
                </div>
              )}

              {/* Notes */}
              <div>
                <h4 className="text-sm font-semibold text-gray-900 mb-2">Notes</h4>
                <textarea
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  rows={3}
                  placeholder="Renewal terms, contacts, reminders…"
                  className={`${inputClass} resize-none`}
                />
                {notesDraft !== (selected.notes ?? '') && (
                  <button onClick={handleSaveNotes} disabled={savingNotes} className="mt-2 px-4 py-2 rounded-xl text-xs font-semibold text-white disabled:opacity-60" style={{ backgroundColor: BRAND }}>
                    {savingNotes ? 'Saving…' : 'Save notes'}
                  </button>
                )}
              </div>

              {/* Document */}
              <div>
                <h4 className="text-sm font-semibold text-gray-900 mb-2">Contract document</h4>
                {selected.hasDocument ? (
                  <div className="p-5 border border-gray-100 rounded-2xl flex flex-col items-center justify-center text-center bg-gray-50">
                    <svg className="w-10 h-10 mb-2" style={{ color: BRAND }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <p className="text-xs font-medium text-gray-600 break-all px-2">{selected.document?.name}</p>
                    <div className="flex items-center gap-4 mt-3">
                      <a href={`/api/contracts/${selected.id}/document`} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-[#03458f] hover:underline">View document</a>
                      <button onClick={() => drawerFileRef.current?.click()} disabled={busy} className="text-xs font-semibold text-gray-400 hover:text-gray-600 disabled:opacity-60">Replace</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => drawerFileRef.current?.click()} disabled={busy} className="w-full p-6 border border-dashed border-gray-200 rounded-2xl flex flex-col items-center justify-center text-center hover:border-[#03458f]/50 transition-colors disabled:opacity-60">
                    <svg className="w-9 h-9 text-gray-300 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    <p className="text-xs font-medium text-gray-400">{busy ? 'Uploading…' : 'Upload contract (PDF / image)'}</p>
                  </button>
                )}
              </div>

              {/* Renew editor */}
              {isRenewOpen && (
                <div className="p-5 bg-gray-50 rounded-2xl border border-gray-100">
                  <label className="text-xs font-medium text-gray-500 mb-1.5 block">New end date</label>
                  <input type="date" value={renewDate} onChange={(e) => setRenewDate(e.target.value)} className={`${inputClass} mb-3 bg-white`} />
                  <div className="flex gap-2">
                    <button onClick={handleRenew} disabled={busy || !renewDate} className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-white disabled:opacity-60" style={{ backgroundColor: BRAND }}>
                      {busy ? 'Saving…' : 'Confirm renewal'}
                    </button>
                    <button onClick={() => setIsRenewOpen(false)} className="px-4 py-2.5 text-gray-500 text-xs font-semibold hover:text-gray-700">Cancel</button>
                  </div>
                </div>
              )}
            </div>

            {isAdmin && (
              <div className="p-6 border-t border-gray-100 sticky bottom-0 bg-white flex flex-col gap-2">
                <div className="flex gap-2">
                  <button onClick={() => setIsRenewOpen((v) => !v)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm" style={{ backgroundColor: BRAND }}>
                    Renew / extend
                  </button>
                  <button onClick={() => openEdit(selected)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                    Edit
                  </button>
                </div>
                <button onClick={handleDelete} disabled={busy} className="w-full py-2.5 text-rose-500 font-semibold text-sm hover:text-rose-600 disabled:opacity-60">
                  Remove contract
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Create / Edit modal */}
      {formOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-gray-900/30 backdrop-blur-sm">
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl z-10">
              <h2 className="text-lg font-semibold text-gray-900">{editing ? 'Edit contract' : 'New contract'}</h2>
              <button onClick={() => setFormOpen(false)} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-50">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={submitForm} className="p-6 space-y-4">
              {error && <div className="px-4 py-3 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-700">{error}</div>}

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Reference *</Label>
                  <input className={inputClass} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="CTR-9901" />
                </div>
                <div className="col-span-2">
                  <Label>Counterparty *</Label>
                  <input className={inputClass} value={form.counterpartyName} onChange={(e) => setForm({ ...form, counterpartyName: e.target.value })} placeholder="Consultant / vendor name" autoFocus />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Email</Label>
                  <input type="email" className={inputClass} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@example.com" />
                </div>
                <div>
                  <Label>Department</Label>
                  <input className={inputClass} value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder="e.g. Operations" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Type</Label>
                  <select className={inputClass} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                    {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <Label>Status</Label>
                  <select className={inputClass} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                    {LIFECYCLE.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Start date *</Label>
                  <input type="date" className={inputClass} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
                </div>
                <div>
                  <Label>End date *</Label>
                  <input type="date" className={inputClass} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <Label>Contract value</Label>
                  <input type="number" min={0} className={inputClass} value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder="Optional" />
                </div>
                <div>
                  <Label>Currency</Label>
                  <select className={inputClass} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                    {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <Label>Notes</Label>
                <textarea rows={2} className={`${inputClass} resize-none`} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Optional" />
              </div>

              <div>
                <Label>Contract document {editing ? '(replaces existing)' : '(optional)'}</Label>
                <input
                  type="file"
                  onChange={(e) => setAddFile(e.target.files?.[0] ?? null)}
                  className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-[#03458f] hover:file:bg-blue-100"
                />
                {addFile && <p className="text-xs text-gray-400 mt-1">{addFile.name}</p>}
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setFormOpen(false)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50">
                  Cancel
                </button>
                <button type="submit" disabled={busy} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm disabled:opacity-50" style={{ backgroundColor: BRAND }}>
                  {busy ? 'Saving…' : editing ? 'Save changes' : 'Create contract'}
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

function Meta({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="bg-gray-50 rounded-xl border border-gray-100 p-3.5">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className={`text-sm font-medium ${warn ? 'text-rose-600' : 'text-gray-900'}`}>{value}</p>
    </div>
  );
}
