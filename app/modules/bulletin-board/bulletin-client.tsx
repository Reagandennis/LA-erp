'use client';

import { APP_LOCALE } from '@/lib/locale';
import { useEffect, useMemo, useState } from 'react';

import { useLiveRefresh } from '@/app/ui/use-live-refresh';
import { MODULE_SOURCES } from '@/lib/live-sources';

import BulletinForm from './bulletin-form';
import { BULLETIN_CATEGORIES, type BulletinData, type BulletinPostDetail, type BulletinPostSummary, type BulletinReader } from './types';

const CATEGORY_STYLES: Record<string, string> = {
  Announcement: 'bg-blue-50 text-blue-700',
  Notice: 'bg-slate-100 text-slate-700',
  Safety: 'bg-rose-50 text-rose-700',
  Event: 'bg-violet-50 text-violet-700',
  Policy: 'bg-emerald-50 text-emerald-700',
  Reminder: 'bg-amber-50 text-amber-700',
};

type CategoryFilter = 'All' | (typeof BULLETIN_CATEGORIES)[number];

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(APP_LOCALE, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** "just now", "3 hours ago", "yesterday", else the date. */
function timeAgo(value: string, nowMs: number): string {
  const diff = nowMs - new Date(value).getTime();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return formatDate(value);
}

interface BulletinClientProps {
  currentUser: { id: number; name: string };
  isAdmin: boolean;
  initialData: BulletinData;
}

export default function BulletinClient({ currentUser, isAdmin, initialData }: BulletinClientProps) {
  const [posts, setPosts] = useState<BulletinPostSummary[]>(initialData.posts);
  const [showExpired, setShowExpired] = useState(false);
  /** Expired notices arrive with the first request for them; until then the switch shows "loading". */
  const [expiredLoaded, setExpiredLoaded] = useState(false);
  const loadingExpired = showExpired && !expiredLoaded;
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('All');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [formState, setFormState] = useState<
    { open: false } | { open: true; mode: 'create' } | { open: true; mode: 'edit'; post: BulletinPostSummary }
  >({ open: false });
  const [error, setError] = useState<string | null>(null);
  const [nowMs] = useState(() => Date.now());

  // The board loads live notices; the switch fetches the expired ones too.
  useEffect(() => {
    if (!showExpired || expiredLoaded) return;
    let cancelled = false;
    fetch('/api/bulletin?all=1', { credentials: 'include', cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<BulletinData>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        if (cancelled) return;
        setPosts(data.posts);
        setExpiredLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setError('Could not load expired notices.');
        setExpiredLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [showExpired, expiredLoaded]);

  // A notice posted, pinned or removed by someone else appears without a
  // reload, keeping the expired ones on screen when the switch is on.
  useLiveRefresh(MODULE_SOURCES['bulletin-board'] ?? [], () => {
    fetch(showExpired ? '/api/bulletin?all=1' : '/api/bulletin', { credentials: 'include', cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<BulletinData>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => setPosts(data.posts))
      .catch(() => {
        // The next change, or the next minute, tries again.
      });
  });

  const stats = useMemo(() => {
    const weekAgo = nowMs - 7 * 24 * 60 * 60 * 1000;
    const live = posts.filter((p) => !p.expired);
    return {
      unread: live.filter((p) => !p.readByMe).length,
      pinned: live.filter((p) => p.pinned).length,
      active: live.length,
      thisWeek: posts.filter((p) => new Date(p.createdAt).getTime() >= weekAgo).length,
    };
  }, [posts, nowMs]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return posts
      .filter((p) => showExpired || !p.expired)
      .filter((p) => category === 'All' || p.category === category)
      .filter(
        (p) =>
          !q ||
          p.title.toLowerCase().includes(q) ||
          p.body.toLowerCase().includes(q) ||
          (p.author?.name.toLowerCase().includes(q) ?? false),
      )
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [posts, showExpired, category, search]);
  const pinnedPosts = visible.filter((p) => p.pinned && !p.expired);
  const otherPosts = visible.filter((p) => !(p.pinned && !p.expired));

  const upsert = (post: BulletinPostSummary) =>
    setPosts((current) => [post, ...current.filter((p) => p.id !== post.id)]);
  const remove = (id: number) => setPosts((current) => current.filter((p) => p.id !== id));

  /** Opening a notice is reading it. */
  const open = (post: BulletinPostSummary) => {
    const next = expandedId === post.id ? null : post.id;
    setExpandedId(next);
    if (next !== null && !post.readByMe) void markSeen(post);
  };

  const markSeen = async (post: BulletinPostSummary) => {
    try {
      const res = await fetch(`/api/bulletin/${post.id}/read`, { method: 'POST', credentials: 'include' });
      const data = (await res.json().catch(() => null)) as { item?: BulletinPostSummary; error?: string } | null;
      if (res.ok && data?.item) upsert(data.item);
    } catch {
      // Seen state is a convenience; the next load gets it right.
    }
  };

  const patch = async (post: BulletinPostSummary, body: Record<string, unknown>) => {
    setError(null);
    try {
      const res = await fetch(`/api/bulletin/${post.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as { item?: BulletinPostSummary; error?: string } | null;
      if (!res.ok || !data?.item) {
        setError(data?.error ?? 'Could not update the notice.');
        return;
      }
      upsert(data.item);
    } catch {
      setError('Network error. Please try again.');
    }
  };

  const takeDown = async (post: BulletinPostSummary) => {
    if (!window.confirm(`Remove "${post.title}" from the board? This cannot be undone.`)) return;
    setError(null);
    try {
      const res = await fetch(`/api/bulletin/${post.id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? 'Could not remove the notice.');
        return;
      }
      remove(post.id);
    } catch {
      setError('Network error. Please try again.');
    }
  };

  const canManage = (post: BulletinPostSummary) => isAdmin || post.author?.id === currentUser.id;

  return (
    <div className="min-h-screen bg-gray-50/50 p-4 sm:p-6 lg:p-10">
      <div className="mx-auto max-w-5xl space-y-6 lg:space-y-8">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-primary sm:text-3xl">Bulletin Board</h1>
            <p className="mt-1 text-sm text-gray-500">
              Notices and announcements for the whole team. Pinned ones stay on top; expired ones come down by themselves.
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
            New notice
          </button>
        </header>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          <SummaryCard label="New for you" value={stats.unread} accent={stats.unread > 0 ? 'text-primary' : undefined} />
          <SummaryCard label="Pinned" value={stats.pinned} />
          <SummaryCard label="On the board" value={stats.active} />
          <SummaryCard label="Posted this week" value={stats.thisWeek} />
        </div>

        <div className="flex flex-col gap-3 rounded-2xl border border-gray-100 bg-white p-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <svg className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search notices…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-xl bg-gray-50 py-2.5 pl-10 pr-4 text-sm text-gray-900 placeholder:text-gray-400 transition focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={showExpired} onChange={(e) => setShowExpired(e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
              Show expired
              {loadingExpired && <span className="text-xs text-gray-400">loading…</span>}
            </label>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(['All', ...BULLETIN_CATEGORIES] as CategoryFilter[]).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition ${category === c ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <p>{error}</p>
            <button type="button" onClick={() => setError(null)} className="text-rose-400 hover:text-rose-600" aria-label="Dismiss">
              ✕
            </button>
          </div>
        )}

        {visible.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-6 py-16 text-center">
            <p className="text-sm text-gray-500">
              {posts.length === 0 ? 'Nothing on the board yet. Post the first notice.' : 'No notices match.'}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {pinnedPosts.length > 0 && (
              <section className="space-y-3">
                <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <PinIcon className="h-3.5 w-3.5" /> Pinned
                </h2>
                {pinnedPosts.map((p) => (
                  <PostCard key={p.id} post={p} expanded={expandedId === p.id} nowMs={nowMs} manageable={canManage(p)} onOpen={() => open(p)} onSeen={() => void markSeen(p)} onEdit={() => setFormState({ open: true, mode: 'edit', post: p })} onPin={() => void patch(p, { pinned: !p.pinned })} onDelete={() => void takeDown(p)} />
                ))}
              </section>
            )}
            <section className="space-y-3">
              {pinnedPosts.length > 0 && otherPosts.length > 0 && (
                <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Latest</h2>
              )}
              {otherPosts.map((p) => (
                <PostCard key={p.id} post={p} expanded={expandedId === p.id} nowMs={nowMs} manageable={canManage(p)} onOpen={() => open(p)} onSeen={() => void markSeen(p)} onEdit={() => setFormState({ open: true, mode: 'edit', post: p })} onPin={() => void patch(p, { pinned: !p.pinned })} onDelete={() => void takeDown(p)} />
              ))}
            </section>
          </div>
        )}
      </div>

      {formState.open && (
        <BulletinForm
          mode={formState.mode}
          post={formState.mode === 'edit' ? formState.post : null}
          onClose={() => setFormState({ open: false })}
          onSaved={(post) => {
            upsert(post);
            setFormState({ open: false });
            setExpandedId(post.id);
          }}
        />
      )}
    </div>
  );
}

function SummaryCard({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4">
      <p className="text-xs text-gray-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${accent ?? 'text-gray-900'}`}>{value}</p>
    </div>
  );
}

function PinIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M16 3a1 1 0 01.78 1.625L15.5 6.22V11l2.5 2.5V15h-5v6l-1 1-1-1v-6H6v-1.5L8.5 11V6.22L7.22 4.625A1 1 0 018 3h8z" />
    </svg>
  );
}

function PostCard({
  post,
  expanded,
  nowMs,
  manageable,
  onOpen,
  onSeen,
  onEdit,
  onPin,
  onDelete,
}: {
  post: BulletinPostSummary;
  expanded: boolean;
  nowMs: number;
  manageable: boolean;
  onOpen: () => void;
  onSeen: () => void;
  onEdit: () => void;
  onPin: () => void;
  onDelete: () => void;
}) {
  // Who has seen it, fetched when someone asks and refetched once the count moves.
  const [readers, setReaders] = useState<{ count: number; list: BulletinReader[] } | null>(null);
  const [showReaders, setShowReaders] = useState(false);
  const readerList = readers && readers.count === post.readCount ? readers.list : null;

  useEffect(() => {
    if (!showReaders || readerList !== null) return;
    let cancelled = false;
    const count = post.readCount;
    fetch(`/api/bulletin/${post.id}`, { credentials: 'include', cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<{ item: BulletinPostDetail }>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        if (!cancelled) setReaders({ count, list: data.item.readers });
      })
      .catch(() => {
        if (!cancelled) setReaders({ count, list: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [showReaders, readerList, post.id, post.readCount]);

  const unread = !post.readByMe && !post.expired;
  const expiresSoon = post.expiresAt && !post.expired && new Date(post.expiresAt).getTime() - nowMs < 3 * 24 * 60 * 60 * 1000;

  return (
    <article
      className={`rounded-2xl border bg-white transition-shadow ${expanded ? 'shadow-md' : 'hover:shadow-sm'} ${unread ? 'border-primary/30' : 'border-gray-100'} ${post.expired ? 'opacity-70' : ''}`}
    >
      <button type="button" onClick={onOpen} aria-expanded={expanded} className="flex w-full items-start gap-3 px-5 pt-4 text-left">
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${unread ? 'bg-primary' : 'bg-transparent'}`} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${CATEGORY_STYLES[post.category] ?? 'bg-gray-100 text-gray-600'}`}>{post.category}</span>
            {post.pinned && !post.expired && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-500">
                <PinIcon className="h-3 w-3" /> Pinned
              </span>
            )}
            {post.expired ? (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-500">Expired {formatDate(post.expiresAt!)}</span>
            ) : (
              post.expiresAt && (
                <span className={`text-[11px] font-medium ${expiresSoon ? 'text-amber-700' : 'text-gray-400'}`}>Until {formatDate(post.expiresAt)}</span>
              )
            )}
          </span>
          <span className={`mt-1 block text-base font-semibold ${unread ? 'text-gray-900' : 'text-gray-800'}`}>{post.title}</span>
          <span className="mt-0.5 block text-xs text-gray-500">
            {post.author?.name ?? 'Someone'} · {timeAgo(post.createdAt, nowMs)}
            {post.updatedAt !== post.createdAt && ' · edited'}
          </span>
        </span>
        <svg className={`mt-1 h-4 w-4 shrink-0 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <div className="px-5 pb-4 pl-10">
        <p className={`mt-2 whitespace-pre-wrap break-words text-sm text-gray-700 ${expanded ? '' : 'line-clamp-3'}`}>{post.body}</p>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
          <button type="button" onClick={() => setShowReaders((v) => !v)} className="text-gray-500 hover:text-gray-800" aria-expanded={showReaders}>
            Seen by {post.readCount}
          </button>
          {post.readByMe ? (
            <span className="inline-flex items-center gap-1 text-emerald-700">
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              You&apos;ve seen this
            </span>
          ) : (
            <button type="button" onClick={onSeen} className="font-semibold text-primary hover:underline">
              Mark as seen
            </button>
          )}
          {manageable && (
            <span className="ml-auto flex items-center gap-1">
              <button type="button" onClick={onEdit} className="rounded-lg px-2 py-1 text-gray-500 hover:bg-gray-100 hover:text-gray-800">
                Edit
              </button>
              <button type="button" onClick={onPin} className="rounded-lg px-2 py-1 text-gray-500 hover:bg-gray-100 hover:text-gray-800">
                {post.pinned ? 'Unpin' : 'Pin'}
              </button>
              <button type="button" onClick={onDelete} className="rounded-lg px-2 py-1 text-gray-500 hover:bg-rose-50 hover:text-rose-600">
                Remove
              </button>
            </span>
          )}
        </div>

        {showReaders && (
          <div className="mt-3 rounded-xl bg-gray-50 px-3.5 py-3 text-xs text-gray-600">
            {readerList === null ? (
              'Loading…'
            ) : readerList.length === 0 ? (
              'Nobody has opened this yet.'
            ) : (
              <ul className="flex flex-wrap gap-x-4 gap-y-1">
                {readerList.map((r) => (
                  <li key={r.id}>
                    <span className="font-medium text-gray-800">{r.name}</span> <span className="text-gray-400">· {formatDate(r.readAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
