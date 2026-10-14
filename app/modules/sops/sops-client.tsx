'use client';

import { APP_LOCALE } from '@/lib/locale';
import React, { useMemo, useState } from 'react';

import type {
  SopDetail,
  SopStats,
  SopSummary,
} from '@/lib/sops';

const BRAND = '#03458f';

const CATEGORIES = ['Safety', 'Operations', 'Human Resources', 'IT & Security', 'Finance'] as const;
const STATUSES = ['Draft', 'Review', 'Active', 'Archived'] as const;

const inputClass =
  'w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#03458f]/30 focus:border-[#03458f]/40';

function statusStyle(status: string): string {
  switch (status) {
    case 'Active': return 'bg-green-50 text-green-700 border-green-100';
    case 'Review': return 'bg-amber-50 text-amber-700 border-amber-100';
    case 'Draft': return 'bg-gray-50 text-gray-500 border-gray-200';
    case 'Archived': return 'bg-slate-100 text-slate-500 border-slate-200';
    default: return 'bg-gray-50 text-gray-500 border-gray-100';
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(APP_LOCALE, { year: 'numeric', month: 'short', day: 'numeric' });
}

type Props = {
  currentUser: { id: number; name: string };
  isAdmin: boolean;
  initialItems: SopSummary[];
  initialStats: SopStats;
};

type SopForm = {
  code: string;
  title: string;
  category: string;
  status: string;
  version: string;
  ownerName: string;
  description: string;
  steps: string[];
  effectiveDate: string;
  reviewDate: string;
  revisionSummary: string;
};

const EMPTY_FORM: SopForm = {
  code: '',
  title: '',
  category: 'Operations',
  status: 'Draft',
  version: 'v1.0',
  ownerName: '',
  description: '',
  steps: [''],
  effectiveDate: '',
  reviewDate: '',
  revisionSummary: '',
};

export default function SopsClient({ currentUser, isAdmin, initialItems, initialStats }: Props) {
  const [items, setItems] = useState<SopSummary[]>(initialItems);
  const [stats, setStats] = useState<SopStats>(initialStats);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [statusFilter, setStatusFilter] = useState<string>('All');

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<SopDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [acking, setAcking] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<SopForm>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshList = async () => {
    try {
      const res = await fetch('/api/sops', { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.items)) setItems(data.items as SopSummary[]);
      if (data.stats) setStats(data.stats as SopStats);
    } catch {
      /* keep current data */
    }
  };

  const openDetail = async (id: number) => {
    setSelectedId(id);
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/sops/${id}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setDetail(data.item as SopDetail);
      }
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    setSelectedId(null);
    setDetail(null);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((s) => {
      if (categoryFilter !== 'All' && s.category !== categoryFilter) return false;
      if (statusFilter !== 'All' && s.status !== statusFilter) return false;
      if (!q) return true;
      return [s.code, s.title, s.ownerName, s.description]
        .filter(Boolean)
        .some((f) => String(f).toLowerCase().includes(q));
    });
  }, [items, search, categoryFilter, statusFilter]);

  const statCards = [
    { label: 'Total SOPs', value: stats.total },
    { label: 'Active', value: stats.active },
    { label: 'In review', value: stats.inReview },
    { label: 'Review overdue', value: stats.reviewOverdue, warn: stats.reviewOverdue > 0 },
  ];

  // --- Acknowledge ----------------------------------------------------------

  const acknowledge = async (id: number) => {
    setAcking(true);
    try {
      const res = await fetch(`/api/sops/${id}/acknowledge`, { method: 'POST', credentials: 'include' });
      if (!res.ok) return;
      const data = (await res.json()) as { ackCount: number };
      setItems((prev) =>
        prev.map((s) => (s.id === id ? { ...s, acknowledgedByMe: true, ackCount: data.ackCount } : s)),
      );
      setDetail((prev) =>
        prev && prev.id === id
          ? {
              ...prev,
              acknowledgedByMe: true,
              ackCount: data.ackCount,
              acknowledgements: prev.acknowledgements.some((a) => a.userId === currentUser.id && a.version === prev.version)
                ? prev.acknowledgements
                : [
                    {
                      userId: currentUser.id,
                      userName: currentUser.name,
                      version: prev.version,
                      acknowledgedAt: new Date().toISOString(),
                    },
                    ...prev.acknowledgements,
                  ],
            }
          : prev,
      );
    } finally {
      setAcking(false);
    }
  };

  // --- Form -----------------------------------------------------------------

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setEditing(false);
    setError(null);
    setFormOpen(true);
  };

  const openEdit = (d: SopDetail) => {
    setForm({
      code: d.code,
      title: d.title,
      category: d.category,
      status: d.status,
      version: d.version,
      ownerName: d.ownerName ?? '',
      description: d.description ?? '',
      steps: d.steps.length ? d.steps : [''],
      effectiveDate: d.effectiveDate ? d.effectiveDate.slice(0, 10) : '',
      reviewDate: d.reviewDate ? d.reviewDate.slice(0, 10) : '',
      revisionSummary: '',
    });
    setEditing(true);
    setError(null);
    setFormOpen(true);
  };

  const setStep = (i: number, value: string) =>
    setForm((f) => ({ ...f, steps: f.steps.map((s, idx) => (idx === i ? value : s)) }));
  const addStep = () => setForm((f) => ({ ...f, steps: [...f.steps, ''] }));
  const removeStep = (i: number) =>
    setForm((f) => ({ ...f, steps: f.steps.length > 1 ? f.steps.filter((_, idx) => idx !== i) : f.steps }));

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.code.trim() || !form.title.trim()) {
      setError('Code and title are required.');
      return;
    }
    setBusy(true);
    setError(null);

    const body = {
      code: form.code.trim(),
      title: form.title.trim(),
      category: form.category,
      status: form.status,
      version: form.version.trim() || 'v1.0',
      ownerName: form.ownerName.trim() || null,
      description: form.description.trim() || null,
      steps: form.steps.map((s) => s.trim()).filter(Boolean),
      effectiveDate: form.effectiveDate || null,
      reviewDate: form.reviewDate || null,
      ...(editing && form.revisionSummary.trim() ? { revisionSummary: form.revisionSummary.trim() } : {}),
    };

    try {
      const url = editing && selectedId ? `/api/sops/${selectedId}` : '/api/sops';
      const method = editing ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        setError(payload?.error ?? 'Could not save the SOP.');
        setBusy(false);
        return;
      }
      await refreshList();
      if (editing && selectedId) await openDetail(selectedId);
      setFormOpen(false);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const removeSop = async (id: number) => {
    if (!window.confirm('Delete this SOP and its revision history? This cannot be undone.')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/sops/${id}`, { method: 'DELETE', credentials: 'include' });
      if (res.ok) {
        closeDetail();
        await refreshList();
      }
    } finally {
      setBusy(false);
    }
  };

  // --- Render ---------------------------------------------------------------

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-10">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Standard Operating Procedures</h1>
            <p className="text-gray-500 mt-1 text-sm">Controlled procedures, approvals, and read acknowledgements.</p>
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
              New SOP
            </button>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          {statCards.map((s) => (
            <div key={s.label} className="bg-white rounded-2xl border border-gray-100 p-4">
              <p className="text-xs text-gray-400 mb-1">{s.label}</p>
              <p className={`text-xl font-semibold ${s.warn ? 'text-rose-600' : 'text-gray-900'}`}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Search + filters */}
        <div className="flex flex-col lg:flex-row gap-3 mb-5">
          <div className="relative flex-1">
            <svg className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search by code, title, owner…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#03458f]/30"
            />
          </div>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="px-3.5 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#03458f]/30">
            <option value="All">All categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3.5 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#03458f]/30">
            <option value="All">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {/* List */}
        {filtered.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-gray-200">
            <p className="text-gray-900 font-medium">No procedures found</p>
            <p className="text-gray-500 text-sm mt-1">
              {items.length === 0
                ? isAdmin ? 'Create your first SOP to get started.' : 'No procedures have been published yet.'
                : 'Try a different search or filter.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((s) => (
              <button
                key={s.id}
                onClick={() => openDetail(s.id)}
                className="w-full text-left bg-white rounded-2xl border border-gray-100 p-5 hover:border-[#03458f]/40 hover:shadow-sm transition-all"
              >
                <div className="flex items-start gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white" style={{ backgroundColor: BRAND }}>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-mono text-gray-400">{s.code}</span>
                      <span className={`px-2 py-0.5 rounded-md text-xs font-medium border ${statusStyle(s.status)}`}>{s.status}</span>
                      <span className="text-xs text-gray-400">{s.version}</span>
                      {s.reviewOverdue && (
                        <span className="px-2 py-0.5 rounded-md text-xs font-medium border border-rose-100 bg-rose-50 text-rose-600">Review overdue</span>
                      )}
                    </div>
                    <p className="font-semibold text-gray-900 mt-1 truncate">{s.title}</p>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-gray-400">
                      <span>{s.category}</span>
                      {s.ownerName && <span>Owner: {s.ownerName}</span>}
                      <span>{s.stepCount} step{s.stepCount === 1 ? '' : 's'}</span>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    {s.acknowledgedByMe ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Acknowledged
                      </span>
                    ) : s.status === 'Active' ? (
                      <span className="text-xs font-medium text-amber-600">Action needed</span>
                    ) : null}
                    <p className="text-xs text-gray-400 mt-1">{s.ackCount} ack{s.ackCount === 1 ? '' : 's'}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Detail drawer */}
      {selectedId !== null && (
        <>
          <div className="fixed inset-0 bg-gray-900/20 backdrop-blur-sm z-40" onClick={closeDetail} />
          <div className="fixed right-0 top-0 h-full w-full max-w-lg bg-white shadow-2xl z-50 overflow-y-auto flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
              <h2 className="text-lg font-semibold text-gray-900">Procedure</h2>
              <button onClick={closeDetail} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-50">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {detailLoading || !detail ? (
              <div className="flex-1 flex items-center justify-center text-sm text-gray-400">Loading…</div>
            ) : (
              <>
                <div className="p-6 flex-1 space-y-7">
                  {/* Title block */}
                  <div>
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <span className="text-xs font-mono text-gray-400">{detail.code}</span>
                      <span className={`px-2 py-0.5 rounded-md text-xs font-medium border ${statusStyle(detail.status)}`}>{detail.status}</span>
                      <span className="text-xs text-gray-400">{detail.version}</span>
                      {detail.reviewOverdue && (
                        <span className="px-2 py-0.5 rounded-md text-xs font-medium border border-rose-100 bg-rose-50 text-rose-600">Review overdue</span>
                      )}
                    </div>
                    <h3 className="text-xl font-semibold text-gray-900">{detail.title}</h3>
                    {detail.description && <p className="text-sm text-gray-500 mt-2 leading-relaxed whitespace-pre-wrap">{detail.description}</p>}
                  </div>

                  {/* Metadata */}
                  <div className="grid grid-cols-2 gap-3">
                    <Meta label="Category" value={detail.category} />
                    <Meta label="Owner" value={detail.ownerName ?? '—'} />
                    <Meta label="Effective date" value={formatDate(detail.effectiveDate)} />
                    <Meta label="Next review" value={formatDate(detail.reviewDate)} warn={detail.reviewOverdue} />
                  </div>

                  {/* Procedure steps */}
                  <div>
                    <h4 className="text-sm font-semibold text-gray-900 mb-3">Procedure</h4>
                    {detail.steps.length === 0 ? (
                      <p className="text-sm text-gray-400">No steps documented yet.</p>
                    ) : (
                      <ol className="space-y-3">
                        {detail.steps.map((step, i) => (
                          <li key={i} className="flex gap-3">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white" style={{ backgroundColor: BRAND }}>
                              {i + 1}
                            </span>
                            <p className="text-sm text-gray-700 leading-relaxed pt-0.5 whitespace-pre-wrap">{step}</p>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>

                  {/* Acknowledgement */}
                  <div className="rounded-2xl border border-gray-100 bg-gray-50 p-5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-semibold text-gray-900">Read acknowledgement</h4>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {detail.ackCount} of {detail.totalUsers} acknowledged {detail.version}
                        </p>
                      </div>
                      {detail.acknowledgedByMe ? (
                        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-green-700">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          You acknowledged
                        </span>
                      ) : (
                        <button
                          onClick={() => acknowledge(detail.id)}
                          disabled={acking}
                          className="px-4 py-2 rounded-xl text-sm font-semibold text-white shadow-sm disabled:opacity-50"
                          style={{ backgroundColor: BRAND }}
                        >
                          {acking ? 'Saving…' : 'I have read & understood'}
                        </button>
                      )}
                    </div>

                    {isAdmin && detail.acknowledgements.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-gray-200 space-y-2">
                        {detail.acknowledgements.map((a) => (
                          <div key={`${a.userId}-${a.version}`} className="flex items-center justify-between text-xs">
                            <span className="text-gray-700">
                              {a.userName}
                              {a.version !== detail.version && <span className="text-gray-400"> ({a.version})</span>}
                            </span>
                            <span className="text-gray-400">{formatDate(a.acknowledgedAt)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Revision history */}
                  <div>
                    <h4 className="text-sm font-semibold text-gray-900 mb-3">Revision history</h4>
                    <div className="space-y-3">
                      {detail.revisions.map((rev) => (
                        <div key={rev.id} className="flex gap-3">
                          <div className="flex flex-col items-center">
                            <span className="w-2 h-2 rounded-full mt-1.5" style={{ backgroundColor: BRAND }} />
                            <span className="w-px flex-1 bg-gray-100" />
                          </div>
                          <div className="pb-1">
                            <p className="text-sm text-gray-900">
                              <span className="font-medium">{rev.version}</span> · {rev.summary}
                            </p>
                            <p className="text-xs text-gray-400 mt-0.5">{rev.changedBy} · {formatDate(rev.createdAt)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {isAdmin && (
                  <div className="p-6 border-t border-gray-100 sticky bottom-0 bg-white flex gap-3">
                    <button
                      onClick={() => removeSop(detail.id)}
                      disabled={busy}
                      className="px-4 py-2.5 rounded-xl border border-rose-200 text-sm font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => openEdit(detail)}
                      className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm"
                      style={{ backgroundColor: BRAND }}
                    >
                      Edit SOP
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* Create / Edit modal */}
      {formOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-gray-900/30 backdrop-blur-sm">
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl z-10">
              <h2 className="text-lg font-semibold text-gray-900">{editing ? 'Edit SOP' : 'New SOP'}</h2>
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
                  <Label>Code *</Label>
                  <input className={inputClass} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="OPS-SAF-01" />
                </div>
                <div className="col-span-2">
                  <Label>Title *</Label>
                  <input className={inputClass} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Emergency Evacuation Procedure" autoFocus />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Category</Label>
                  <select className={inputClass} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <Label>Status</Label>
                  <select className={inputClass} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <Label>Version</Label>
                  <input className={inputClass} value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} placeholder="v1.0" />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Owner</Label>
                  <input className={inputClass} value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} placeholder="Accountable person" />
                </div>
                <div>
                  <Label>Effective date</Label>
                  <input type="date" className={inputClass} value={form.effectiveDate} onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })} />
                </div>
                <div>
                  <Label>Next review</Label>
                  <input type="date" className={inputClass} value={form.reviewDate} onChange={(e) => setForm({ ...form, reviewDate: e.target.value })} />
                </div>
              </div>

              <div>
                <Label>Description</Label>
                <textarea rows={2} className={inputClass} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Purpose and scope of this procedure" />
              </div>

              <div>
                <Label>Procedure steps</Label>
                <div className="space-y-2">
                  {form.steps.map((step, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-500">{i + 1}</span>
                      <input
                        className={inputClass}
                        value={step}
                        onChange={(e) => setStep(i, e.target.value)}
                        placeholder={`Step ${i + 1}`}
                      />
                      <button type="button" onClick={() => removeStep(i)} className="p-2 text-gray-300 hover:text-rose-500" aria-label="Remove step">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={addStep} className="mt-2 text-sm font-semibold text-[#03458f] hover:underline">
                  + Add step
                </button>
              </div>

              {editing && (
                <div>
                  <Label>Revision summary <span className="font-normal text-gray-400">(logged in history)</span></Label>
                  <input className={inputClass} value={form.revisionSummary} onChange={(e) => setForm({ ...form, revisionSummary: e.target.value })} placeholder="e.g. Updated assembly point" />
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setFormOpen(false)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50">
                  Cancel
                </button>
                <button type="submit" disabled={busy} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm disabled:opacity-50" style={{ backgroundColor: BRAND }}>
                  {busy ? 'Saving…' : editing ? 'Save changes' : 'Create SOP'}
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
