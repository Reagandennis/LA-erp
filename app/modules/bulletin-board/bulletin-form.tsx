'use client';

import { useState } from 'react';

import { BULLETIN_CATEGORIES, type BulletinPostSummary, TITLE_MAX } from './types';

interface BulletinFormProps {
  mode: 'create' | 'edit';
  post: BulletinPostSummary | null;
  onClose: () => void;
  onSaved: (post: BulletinPostSummary) => void;
}

const inputClass =
  'w-full rounded-xl bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30';

function Label({ children }: { children: React.ReactNode }) {
  return <label className="mb-1.5 block text-xs font-semibold text-gray-500">{children}</label>;
}

/** Write or change a notice. The server validates again; this only keeps the obvious mistakes off the wire. */
export default function BulletinForm({ mode, post, onClose, onSaved }: BulletinFormProps) {
  const [title, setTitle] = useState(post?.title ?? '');
  const [category, setCategory] = useState(post?.category ?? 'Announcement');
  const [body, setBody] = useState(post?.body ?? '');
  const [pinned, setPinned] = useState(post?.pinned ?? false);
  const [expiresAt, setExpiresAt] = useState(post?.expiresAt ? post.expiresAt.slice(0, 10) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!title.trim()) {
      setError('Give the notice a title.');
      return;
    }
    if (!body.trim()) {
      setError('Write the notice before posting it.');
      return;
    }
    setBusy(true);
    setError(null);
    const payload = {
      title: title.trim(),
      category,
      body: body.trim(),
      pinned,
      expiresAt: expiresAt || null,
    };
    try {
      const url = mode === 'edit' && post ? `/api/bulletin/${post.id}` : '/api/bulletin';
      const res = await fetch(url, {
        method: mode === 'edit' ? 'PATCH' : 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => null)) as { item?: BulletinPostSummary; error?: string } | null;
      if (!res.ok || !data?.item) {
        setError(data?.error ?? 'Could not save the notice.');
        return;
      }
      onSaved(data.item);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-[220] bg-gray-900/40 backdrop-blur-sm" onClick={() => !busy && onClose()} />
      <div className="fixed inset-0 z-[230] flex items-end justify-center p-0 sm:items-center sm:p-4">
        <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-2xl">
          <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
            <div>
              <h2 className="text-lg font-bold text-gray-900">{mode === 'edit' ? 'Edit notice' : 'New notice'}</h2>
              <p className="text-sm text-gray-500">Everyone with the Bulletin Board sees it.</p>
            </div>
            <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700" aria-label="Close">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {error && <p className="border-b border-rose-100 bg-rose-50 px-6 py-2.5 text-sm font-medium text-rose-700">{error}</p>}

          <div className="space-y-4 overflow-y-auto px-6 py-5">
            <div>
              <Label>Title</Label>
              <input
                value={title}
                maxLength={TITLE_MAX}
                autoFocus
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Office closed on Friday 21 Nov"
                className={inputClass}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Category</Label>
                <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
                  {BULLETIN_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Take down after (optional)</Label>
                <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className={inputClass} />
              </div>
            </div>
            <div>
              <Label>Notice</Label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={8}
                placeholder="What everyone needs to know. Line breaks are kept."
                className={inputClass}
              />
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-gray-100 bg-gray-50 px-3.5 py-3">
              <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-gray-300" />
              <span>
                <span className="block text-sm font-medium text-gray-900">Pin to the top</span>
                <span className="block text-xs text-gray-500">For notices everyone must see before anything else.</span>
              </span>
            </label>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-6 py-4">
            <button type="button" onClick={onClose} disabled={busy} className="rounded-xl px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy}
              className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              {busy ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Post notice'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
