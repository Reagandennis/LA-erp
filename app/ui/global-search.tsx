'use client';

import { useRouter } from 'next/navigation';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { SearchIcon } from './icons';
import { useIsClient } from './use-client';

/**
 * Search everything: the box in the top bar, and the panel it opens.
 *
 * Modules match instantly in the browser; records (trips, tasks, quotes,
 * people, chats…) come from /api/search, which only returns what the person
 * can already see. Opens with the box, Ctrl/⌘ K, "/", or `openGlobalSearch()`.
 */

export interface SearchModule {
  slug: string;
  name: string;
  category: string;
}

interface Hit {
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
}

interface Group {
  id: string;
  label: string;
  hits: Hit[];
}

interface Item extends Hit {
  group: string;
}

const OPEN_EVENT = 'la-erp:open-search';
/**
 * Recent picks are kept per person, not per browser: on a shared computer the
 * next person to sign in must not see the titles of what someone else opened.
 */
const recentKey = (userId: number) => `la-erp.search-recent:${userId}`;
/** Where recents lived before they were per person; cleared on sight. */
const LEGACY_RECENT_KEY = 'la-erp.search-recent';
const MAX_RECENT = 6;
const MIN_QUERY = 2;

/** Open the panel from anywhere (the collapsed sidebar uses this), optionally with a query. */
export function openGlobalSearch(query = ''): void {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { query } }));
}

function readRecent(userId: number, modules: SearchModule[]): Item[] {
  try {
    window.localStorage.removeItem(LEGACY_RECENT_KEY);
    const raw = window.localStorage.getItem(recentKey(userId));
    const items = raw ? (JSON.parse(raw) as Item[]) : [];
    // A module taken away since it was opened no longer shows up.
    const allowed = new Set(modules.map((m) => `/modules/${m.slug}`));
    return items
      .filter((item) => {
        const base = item.href.match(/^\/modules\/[^/?#]+/)?.[0];
        return !base || allowed.has(base);
      })
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

function remember(userId: number, modules: SearchModule[], item: Item): void {
  try {
    const next = [item, ...readRecent(userId, modules).filter((r) => r.href !== item.href)].slice(0, MAX_RECENT);
    window.localStorage.setItem(recentKey(userId), JSON.stringify(next));
  } catch {
    // A convenience only.
  }
}

function isTypingIn(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)));
}

function matchModules(modules: SearchModule[], query: string): Item[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const score = (m: SearchModule) => {
    const name = m.name.toLowerCase();
    if (name.startsWith(q)) return 0;
    if (name.split(/[\s&/-]+/).some((w) => w.startsWith(q))) return 1;
    if (name.includes(q) || m.slug.includes(q)) return 2;
    if (m.category.toLowerCase().includes(q)) return 3;
    return -1;
  };
  return modules
    .map((m) => ({ m, s: score(m) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => a.s - b.s || a.m.name.localeCompare(b.m.name))
    .slice(0, 6)
    .map(({ m }) => ({ id: `module-${m.slug}`, title: m.name, subtitle: m.category, href: `/modules/${m.slug}`, group: 'Modules' }));
}

/** The first match of `query` in `text`, emphasised. */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  const at = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded bg-amber-100 px-0.5 text-inherit">{text.slice(at, at + q.length)}</mark>
      {text.slice(at + q.length)}
    </>
  );
}

export default function GlobalSearch({ userId, modules }: { userId: number; modules: SearchModule[] }) {
  const router = useRouter();
  const isClient = useIsClient();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ q: string; groups: Group[]; error?: string } | null>(null);
  const [recent, setRecent] = useState<Item[]>([]);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const isMac = isClient && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

  const show = (initial = '') => {
    setRecent(readRecent(userId, modules));
    setQuery(initial);
    setActive(0);
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    setQuery('');
    setResults(null);
  };

  // Ctrl/⌘ K anywhere; "/" when not already typing; or a request from elsewhere.
  const showRef = useRef(show);
  useEffect(() => {
    showRef.current = show;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (open) close();
        else showRef.current();
      } else if (e.key === '/' && !open && !isTypingIn(e.target)) {
        e.preventDefault();
        showRef.current();
      }
    };
    const onRequest = (e: Event) => showRef.current((e as CustomEvent<{ query?: string }>).detail?.query ?? '');
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_EVENT, onRequest);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_EVENT, onRequest);
    };
  }, [open]);

  // Records: one request per pause in typing; a newer query cancels the last.
  const q = query.trim();
  useEffect(() => {
    if (!open || q.length < MIN_QUERY) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
          credentials: 'include',
          signal: controller.signal,
        });
        const data = (await response.json().catch(() => null)) as { groups?: Group[]; error?: string } | null;
        setResults({ q, groups: data?.groups ?? [], error: response.ok ? undefined : data?.error ?? 'Search failed.' });
      } catch {
        if (!controller.signal.aborted) setResults({ q, groups: [], error: 'Could not reach the server.' });
      }
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q, open]);

  const loading = q.length >= MIN_QUERY && results?.q !== q;
  const sections = useMemo(() => {
    if (!q) return recent.length ? [{ label: 'Recent', items: recent }] : [];
    const list: Array<{ label: string; items: Item[] }> = [];
    const moduleItems = matchModules(modules, q);
    if (moduleItems.length) list.push({ label: 'Modules', items: moduleItems });
    if (results?.q === q) {
      for (const g of results.groups) list.push({ label: g.label, items: g.hits.map((h) => ({ ...h, group: g.label })) });
    }
    return list;
  }, [q, recent, modules, results]);
  const items = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const current = Math.min(active, Math.max(0, items.length - 1));

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${current}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  const choose = (item: Item) => {
    remember(userId, modules, item);
    close();
    // The record is already the one in the URL (opened, then closed): the page
    // wouldn't notice a navigation to the same address, so load it afresh.
    if (item.href === `${window.location.pathname}${window.location.search}`) window.location.assign(item.href);
    else router.push(item.href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((current + 1) % Math.max(1, items.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((current - 1 + items.length) % Math.max(1, items.length));
    } else if (e.key === 'Enter' && items[current]) {
      e.preventDefault();
      choose(items[current]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  let index = -1;

  return (
    <>
      <button
        type="button"
        onClick={() => show()}
        aria-label="Search everything"
        aria-keyshortcuts="Control+K Meta+K /"
        className="flex h-8 shrink-0 items-center gap-2 rounded-full border border-white/20 bg-white/10 px-2.5 font-sans text-white/80 transition-colors hover:bg-white/25 hover:text-white @min-[42rem]:w-52 @min-[64rem]:w-64"
      >
        <SearchIcon className="h-4 w-4 shrink-0" />
        <span className="hidden flex-1 text-left text-xs @min-[42rem]:inline">Search everything…</span>
        <kbd className="hidden rounded border border-white/25 px-1.5 text-[10px] font-semibold text-white/70 @min-[42rem]:inline">
          {isMac ? '⌘K' : 'Ctrl K'}
        </kbd>
      </button>

      {isClient &&
        open &&
        createPortal(
          <div className="fixed inset-0 z-[230] flex items-start justify-center bg-gray-900/30 px-4 pt-[10vh] font-sans backdrop-blur-[2px]" onMouseDown={close}>
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Search everything"
              onMouseDown={(e) => e.stopPropagation()}
              className="w-full max-w-2xl overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl"
            >
              <div className="flex items-center gap-3 border-b border-gray-100 px-4">
                <SearchIcon className="h-5 w-5 shrink-0 text-gray-400" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                  }}
                  onKeyDown={onKeyDown}
                  placeholder="Search modules, trips, tasks, quotes, people, chats…"
                  aria-label="Search"
                  aria-controls="global-search-results"
                  aria-activedescendant={items[current] ? `search-item-${current}` : undefined}
                  className="h-14 min-w-0 flex-1 bg-transparent text-base text-gray-900 placeholder:text-gray-400 focus:outline-none"
                />
                {loading && <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-gray-200 border-t-primary" aria-label="Searching" />}
                <kbd className="hidden shrink-0 rounded border border-gray-200 px-1.5 text-[10px] font-semibold text-gray-400 sm:inline">Esc</kbd>
              </div>

              <div id="global-search-results" ref={listRef} role="listbox" className="max-h-[60vh] overflow-y-auto p-2">
                {sections.map((section) => (
                  <Fragment key={section.label}>
                    <p className="px-3 pb-1 pt-3 text-[10px] font-bold uppercase tracking-widest text-gray-400">{section.label}</p>
                    {section.items.map((item) => {
                      index += 1;
                      const i = index;
                      return (
                        <button
                          key={`${section.label}-${item.id}`}
                          id={`search-item-${i}`}
                          data-index={i}
                          type="button"
                          role="option"
                          aria-selected={i === current}
                          onMouseMove={() => i !== current && setActive(i)}
                          onClick={() => choose(item)}
                          className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${i === current ? 'bg-primary/5' : ''}`}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-gray-900">
                              <Highlight text={item.title} query={q} />
                            </span>
                            {item.subtitle && <span className="block truncate text-xs text-gray-500">{item.subtitle}</span>}
                          </span>
                          {!q && <span className="shrink-0 rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">{item.group}</span>}
                          {i === current && <span className="shrink-0 text-xs text-gray-400" aria-hidden="true">↵</span>}
                        </button>
                      );
                    })}
                  </Fragment>
                ))}

                {!q && sections.length === 0 && (
                  <p className="px-3 py-8 text-center text-sm text-gray-500">
                    Type to search modules, trips, tasks, quotes, invoices, clients, people, travelers, chats and more.
                  </p>
                )}
                {q.length > 0 && q.length < MIN_QUERY && items.length === 0 && (
                  <p className="px-3 py-8 text-center text-sm text-gray-500">Keep typing…</p>
                )}
                {q.length >= MIN_QUERY && !loading && items.length === 0 && (
                  <p className="px-3 py-8 text-center text-sm text-gray-500">
                    {results?.error ?? <>Nothing matches “{q}” in the modules you can use.</>}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-4 border-t border-gray-100 bg-gray-50/70 px-4 py-2 text-[11px] text-gray-400">
                <span><kbd className="font-semibold">↑↓</kbd> to move</span>
                <span><kbd className="font-semibold">↵</kbd> to open</span>
                <span><kbd className="font-semibold">Esc</kbd> to close</span>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
