'use client';

import React, { useMemo, useState } from 'react';

import type { NoteSummary } from '@/lib/notes';

const BRAND = '#03458f';

const CATEGORIES = ['Personal', 'Work', 'Ideas'] as const;
const COLORS = ['yellow', 'blue', 'green', 'pink', 'purple', 'gray'] as const;

const COLOR_MAP: Record<string, { card: string; swatch: string }> = {
  yellow: { card: 'bg-amber-50 border-amber-200', swatch: '#f9b232' },
  blue: { card: 'bg-blue-50 border-blue-200', swatch: '#03458f' },
  green: { card: 'bg-green-50 border-green-200', swatch: '#16a34a' },
  pink: { card: 'bg-pink-50 border-pink-200', swatch: '#ec4899' },
  purple: { card: 'bg-purple-50 border-purple-200', swatch: '#7c3aed' },
  gray: { card: 'bg-gray-50 border-gray-200', swatch: '#64748b' },
};

const inputClass =
  'w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#03458f]/30 focus:border-[#03458f]/40';

function cardClasses(color: string) {
  return COLOR_MAP[color]?.card ?? COLOR_MAP.yellow.card;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

type NoteForm = {
  title: string;
  content: string;
  category: string;
  color: string;
  pinned: boolean;
};

const EMPTY_FORM: NoteForm = { title: '', content: '', category: 'Work', color: 'yellow', pinned: false };

export default function NotesClient({ initialItems }: { initialItems: NoteSummary[] }) {
  const [items, setItems] = useState<NoteSummary[]>(initialItems);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('All');

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<NoteForm>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const res = await fetch('/api/notes', { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.items)) setItems(data.items as NoteSummary[]);
    } catch {
      /* ignore */
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((n) => {
      if (category !== 'All' && n.category !== category) return false;
      if (!q) return true;
      return n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q);
    });
  }, [items, search, category]);

  const pinned = filtered.filter((n) => n.pinned);
  const others = filtered.filter((n) => !n.pinned);

  // --- Editor ---------------------------------------------------------------

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setError(null);
    setEditorOpen(true);
  };

  const openEdit = (n: NoteSummary) => {
    setForm({ title: n.title, content: n.content, category: n.category, color: n.color, pinned: n.pinned });
    setEditingId(n.id);
    setError(null);
    setEditorOpen(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) {
      setError('Give the note a title.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const url = editingId ? `/api/notes/${editingId}` : '/api/notes';
      const method = editingId ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title.trim(),
          content: form.content,
          category: form.category,
          color: form.color,
          pinned: form.pinned,
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        setError(payload?.error ?? 'Could not save the note.');
        setBusy(false);
        return;
      }
      await refresh();
      setEditorOpen(false);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const togglePin = async (n: NoteSummary) => {
    // optimistic
    setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, pinned: !x.pinned } : x)));
    try {
      const res = await fetch(`/api/notes/${n.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned: !n.pinned }),
      });
      if (res.ok) await refresh();
      else setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, pinned: n.pinned } : x)));
    } catch {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, pinned: n.pinned } : x)));
    }
  };

  const remove = async (id: number) => {
    if (!window.confirm('Delete this note?')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/notes/${id}`, { method: 'DELETE', credentials: 'include' });
      if (res.ok) {
        setEditorOpen(false);
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  // --- Render ---------------------------------------------------------------

  const NoteCard = ({ n }: { n: NoteSummary }) => (
    <div
      onClick={() => openEdit(n)}
      className={`group relative break-inside-avoid mb-4 rounded-2xl border p-4 cursor-pointer hover:shadow-sm transition-shadow ${cardClasses(n.color)}`}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          void togglePin(n);
        }}
        className={`absolute top-3 right-3 p-1 rounded-lg transition-colors ${n.pinned ? 'text-[#03458f]' : 'text-gray-300 hover:text-gray-500'}`}
        aria-label={n.pinned ? 'Unpin' : 'Pin'}
        title={n.pinned ? 'Unpin' : 'Pin'}
      >
        <svg className="w-4 h-4" fill={n.pinned ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5l7 0m-3.5 0v6l-2 4h11l-2-4V5m-3.5 10v4" />
        </svg>
      </button>
      <h3 className="font-semibold text-gray-900 pr-7 break-words">{n.title}</h3>
      {n.content && <p className="text-sm text-gray-600 mt-1.5 whitespace-pre-wrap break-words line-clamp-[12]">{n.content}</p>}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-black/5">
        <span className="text-xs font-medium text-gray-500">{n.category}</span>
        <span className="text-xs text-gray-400">{formatDate(n.updatedAt)}</span>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-10">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Notes</h1>
            <p className="text-gray-500 mt-1 text-sm">Capture quick notes, observations, and operational context.</p>
          </div>
          <button
            onClick={openCreate}
            className="self-start md:self-auto inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm transition-colors hover:opacity-95"
            style={{ backgroundColor: BRAND }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New note
          </button>
        </div>

        {/* Search + filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <svg className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search notes…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#03458f]/30"
            />
          </div>
          <div className="flex items-center gap-1 bg-white border border-gray-100 rounded-xl p-1">
            {(['All', ...CATEGORIES] as const).map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                  category === c ? 'text-white' : 'text-gray-500 hover:bg-gray-50'
                }`}
                style={category === c ? { backgroundColor: BRAND } : undefined}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* Board */}
        {filtered.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-gray-200">
            <p className="text-gray-900 font-medium">{items.length === 0 ? 'No notes yet' : 'No matching notes'}</p>
            <p className="text-gray-500 text-sm mt-1">
              {items.length === 0 ? 'Create your first note to get started.' : 'Try a different search or category.'}
            </p>
          </div>
        ) : (
          <>
            {pinned.length > 0 && (
              <div className="mb-8">
                <div className="flex items-center gap-2 mb-3">
                  <svg className="w-3.5 h-3.5 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M5 5l7 0m-3.5 0v6l-2 4h11l-2-4V5m-3.5 10v4" stroke="currentColor" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <h2 className="text-sm font-semibold text-gray-900">Pinned</h2>
                  <span className="text-xs text-gray-400">{pinned.length}</span>
                </div>
                <div className="columns-1 sm:columns-2 lg:columns-3 gap-4">
                  {pinned.map((n) => <NoteCard key={n.id} n={n} />)}
                </div>
              </div>
            )}

            {others.length > 0 && (
              <div>
                {pinned.length > 0 && <h2 className="text-sm font-semibold text-gray-900 mb-3">Others</h2>}
                <div className="columns-1 sm:columns-2 lg:columns-3 gap-4">
                  {others.map((n) => <NoteCard key={n.id} n={n} />)}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Editor modal */}
      {editorOpen && (
        <div className="fixed inset-0 z-[230] flex items-center justify-center p-4 bg-gray-900/30 backdrop-blur-sm">
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl">
              <h2 className="text-lg font-semibold text-gray-900">{editingId ? 'Edit note' : 'New note'}</h2>
              <button onClick={() => setEditorOpen(false)} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-50">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={save} className="p-6 space-y-4">
              {error && <div className="px-4 py-3 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-700">{error}</div>}

              <div>
                <label className="text-xs font-medium text-gray-500 mb-1.5 block">Title *</label>
                <input className={inputClass} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Note title" autoFocus />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 mb-1.5 block">Content</label>
                <textarea rows={6} className={`${inputClass} resize-none`} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="Write your note…" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1.5 block">Category</label>
                  <select className={inputClass} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1.5 block">Color</label>
                  <div className="flex items-center gap-2 h-[42px]">
                    {COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setForm({ ...form, color: c })}
                        className={`w-7 h-7 rounded-full border-2 transition-transform ${form.color === c ? 'scale-110 border-gray-400' : 'border-transparent'}`}
                        style={{ backgroundColor: COLOR_MAP[c].swatch }}
                        aria-label={c}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" checked={form.pinned} onChange={(e) => setForm({ ...form, pinned: e.target.checked })} className="w-4 h-4 rounded accent-[#03458f]" />
                Pin to top
              </label>

              <div className="flex items-center gap-3 pt-2">
                {editingId && (
                  <button type="button" onClick={() => remove(editingId)} disabled={busy} className="px-4 py-2.5 rounded-xl border border-rose-200 text-sm font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50">
                    Delete
                  </button>
                )}
                <button type="button" onClick={() => setEditorOpen(false)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50">
                  Cancel
                </button>
                <button type="submit" disabled={busy} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm disabled:opacity-50" style={{ backgroundColor: BRAND }}>
                  {busy ? 'Saving…' : editingId ? 'Save' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
