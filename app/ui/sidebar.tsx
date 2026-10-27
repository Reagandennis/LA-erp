'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { openGlobalSearch } from './global-search';
import LogoutButton from './logout-button';
import { type MessagingService, useMessagingUnread } from './messaging-alerts-store';
import { moduleIcon } from './module-icons';
import { useIsClient } from './use-client';

// --- Recently opened modules (per browser) ----------------------------------

const RECENT_KEY = 'la-erp.recent-modules';
const MAX_RECENT = 4;
const NO_RECENT: string[] = [];
const recentListeners = new Set<() => void>();
let recentCache: { raw: string | null; slugs: string[] } = { raw: null, slugs: NO_RECENT };

function recentSnapshot(): string[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(RECENT_KEY);
  } catch {
    return NO_RECENT;
  }
  if (raw !== recentCache.raw) {
    let slugs = NO_RECENT;
    try {
      slugs = raw ? (JSON.parse(raw) as string[]).filter((v) => typeof v === 'string') : NO_RECENT;
    } catch {
      // Unreadable: start again.
    }
    recentCache = { raw, slugs };
  }
  return recentCache.slugs;
}

function rememberModule(slug: string): void {
  try {
    const next = [slug, ...recentSnapshot().filter((s) => s !== slug)].slice(0, MAX_RECENT);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    for (const listener of recentListeners) listener();
  } catch {
    // A convenience only.
  }
}

function subscribeRecent(listener: () => void) {
  recentListeners.add(listener);
  return () => recentListeners.delete(listener);
}

/** Only worth a "Recent" group once the list is long enough to scroll. */
const RECENT_FROM_MODULES = 8;

/** Sits straight under Dashboard instead of in its category group. */
const PINNED_SLUG = 'ops-dashboard';

/** Below this width the sidebar starts collapsed and overlays the page when opened. */
const SMALL_SCREEN = '(max-width: 1023px)';
const isSmallScreen = () => typeof window !== 'undefined' && window.matchMedia(SMALL_SCREEN).matches;

interface Module {
  id: string | number;
  slug: string;
  name: string;
  category: string;
}

interface User {
  name: string;
  email: string;
}

interface SidebarProps {
  user: User;
  modules: Module[];
}

export default function Sidebar({ user, modules = [] }: SidebarProps) {
  const pathname = usePathname();
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Phones and small tablets start collapsed (decided on the first client
  // render, so the server HTML still matches), and close again after a tap on
  // a link so the page you asked for is not hidden behind the menu.
  const isClient = useIsClient();
  const [sizedForScreen, setSizedForScreen] = useState(false);
  if (isClient && !sizedForScreen) {
    setSizedForScreen(true);
    if (isSmallScreen()) setIsCollapsed(true);
  }
  const [lastPathname, setLastPathname] = useState(pathname);
  if (lastPathname !== pathname) {
    setLastPathname(pathname);
    if (isSmallScreen()) setIsCollapsed(true);
  }

  const router = useRouter();
  const [filter, setFilter] = useState('');
  const needle = filter.trim().toLowerCase();
  const shown = useMemo(
    () =>
      needle
        ? modules.filter(
            (m) =>
              m.name.toLowerCase().includes(needle) ||
              m.slug.includes(needle) ||
              (m.category || '').toLowerCase().includes(needle),
          )
        : modules,
    [modules, needle],
  );

  // Remember which modules are opened, for the Recent group.
  useEffect(() => {
    const slug = pathname.match(/^\/modules\/([^/?#]+)/)?.[1];
    if (slug && modules.some((m) => m.slug === slug)) rememberModule(slug);
  }, [pathname, modules]);
  const recentSlugs = useSyncExternalStore(subscribeRecent, recentSnapshot, () => NO_RECENT);
  const recentModules =
    !needle && modules.length >= RECENT_FROM_MODULES
      ? recentSlugs.map((slug) => modules.find((m) => m.slug === slug)).filter((m): m is Module => Boolean(m))
      : [];

  const pinned = shown.find((m) => m.slug === PINNED_SLUG);
  const showDashboard = !needle || 'dashboard'.includes(needle);

  // Group modules by category
  const groupedModules: Record<string, Module[]> = {};
  for (const m of shown) {
    if (m === pinned) continue;
    const cat = m.category || 'Other';
    if (!groupedModules[cat]) {
      groupedModules[cat] = [];
    }
    groupedModules[cat].push(m);
  }

  const isActive = (path: string) => pathname === path;

  const renderModule = (module: Module, keyPrefix = '') => {
    const active = isActive(`/modules/${module.slug}`);
    const badge = unreadFor(module.slug);
    const badgeText = badge > 99 ? '99+' : String(badge);
    return (
      <Link
        key={`${keyPrefix}${module.id}`}
        href={`/modules/${module.slug}`}
        title={isCollapsed ? (badge > 0 ? `${module.name} (${badge} unread)` : module.name) : ""}
        className={`flex items-center gap-3 rounded-lg transition-all text-sm font-bold group ${
          isCollapsed ? 'justify-center p-2.5' : 'px-3 py-2.5'
        } ${
          active
            ? 'bg-primary text-secondary'
            : 'text-primary/70 hover:bg-primary/5 hover:text-primary'
        }`}
      >
        <div className="relative w-6 h-6 flex items-center justify-center shrink-0">
          {moduleIcon(module.slug)}
          {isCollapsed && badge > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 rounded-full bg-emerald-500 text-white text-[9px] font-black leading-4 text-center ring-2 ring-secondary">
              {badgeText}
            </span>
          )}
        </div>
        {!isCollapsed && <span className="whitespace-nowrap truncate">{module.name}</span>}
        {!isCollapsed && badge > 0 && (
          <span className="ml-auto shrink-0 min-w-5 h-5 px-1.5 rounded-full bg-emerald-500 text-white text-[10px] font-black leading-5 text-center">
            {badgeText}
            <span className="sr-only"> unread chats</span>
          </span>
        )}
      </Link>
    );
};

  // Chats with unread messages, for the messaging modules' badges.
  const unread = useMessagingUnread();
  const unreadFor = (slug: string) => (slug in unread ? unread[slug as MessagingService] : 0);

  return (
    <>
    {!isCollapsed && (
      <button
        type="button"
        aria-label="Close menu"
        onClick={() => setIsCollapsed(true)}
        className="fixed inset-0 z-[95] bg-primary/30 lg:hidden"
      />
    )}
    <aside
      className={`bg-secondary h-screen flex flex-col fixed left-0 top-0 overflow-hidden border-r border-primary/10 transition-all duration-300 z-[100] ${
        isCollapsed ? 'w-16' : 'w-72'
      }`}
    >
      {/* Header with Toggle */}
      <div className="p-4 border-b border-primary/5 flex items-center justify-between min-h-[72px]">
        {!isCollapsed && (
          <div className="flex items-center gap-3 animate-in fade-in duration-300">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center text-secondary font-bold text-sm shrink-0">
              LA
            </div>
            <h1 className="text-primary font-black text-base tracking-tight truncate">LA-ERP</h1>
          </div>
        )}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className={`p-2 bg-primary/5 hover:bg-primary/10 rounded-lg text-primary transition-all ${isCollapsed ? 'mx-auto' : ''}`}
        >
          {isCollapsed ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          )}
        </button>
      </div>

      {/* Find a module */}
      <div className="px-3 pt-3">
        {isCollapsed ? (
          <button
            type="button"
            onClick={() => openGlobalSearch()}
            title="Search everything (Ctrl K)"
            aria-label="Search everything"
            className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg text-primary/70 transition-all hover:bg-primary/5 hover:text-primary"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>
        ) : (
          <label className="relative block">
            <span className="sr-only">Find a module</span>
            <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary/40" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setFilter('');
                if (e.key === 'Enter' && shown[0]) {
                  setFilter('');
                  router.push(`/modules/${shown[0].slug}`);
                }
              }}
              placeholder="Find a module…"
              className="w-full rounded-lg border border-primary/10 bg-primary/5 py-2 pl-9 pr-3 text-sm font-medium text-primary placeholder:text-primary/40 focus:border-primary/30 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/15"
            />
          </label>
        )}
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto p-3 space-y-6 custom-scrollbar scrollbar-hide">
        {!isCollapsed && needle && shown.length === 0 && (
          <div className="px-3 py-2 text-xs text-primary/60">
            <p>No module matches “{filter.trim()}”.</p>
            <button
              type="button"
              onClick={() => {
                openGlobalSearch(filter.trim());
                setFilter('');
              }}
              className="mt-2 font-bold text-primary underline-offset-2 hover:underline"
            >
              Search everything for “{filter.trim()}” →
            </button>
          </div>
        )}

        {recentModules.length > 0 && (
          <div className="space-y-1">
            {!isCollapsed ? (
              <h3 className="px-3 text-[10px] font-black text-primary/30 uppercase tracking-[0.2em] mb-2">Recent</h3>
            ) : (
              <div className="border-t border-primary/10 mx-1 my-3" />
            )}
            {recentModules.map((m) => renderModule(m, 'recent-'))}
          </div>
        )}

        {(showDashboard || pinned) && (
        <div className="space-y-1">
          {showDashboard && (
           <Link
            href="/dashboard"
            title={isCollapsed ? "Dashboard" : ""}
            className={`flex items-center gap-3 rounded-lg transition-all font-bold ${
              isCollapsed ? 'justify-center p-2.5' : 'px-3 py-2.5'
            } ${
              isActive('/dashboard')
                ? 'bg-primary text-secondary'
                : 'text-primary/70 hover:bg-primary/5 hover:text-primary'
            }`}
          >
            <div className="w-6 h-6 flex items-center justify-center shrink-0">
               <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
            </div>
            {!isCollapsed && <span className="whitespace-nowrap truncate text-sm">Dashboard</span>}
          </Link>
          )}
          {pinned && renderModule(pinned)}
        </div>
        )}

        {Object.entries(groupedModules).map(([category, categoryModules]) => (
          <div key={category} className="space-y-1">
            {!isCollapsed ? (
              <h3 className="px-3 text-[10px] font-black text-primary/30 uppercase tracking-[0.2em] mb-2">
                {category}
              </h3>
            ) : (
              <div className="border-t border-primary/10 mx-1 my-3" />
            )}
            {categoryModules.map((m) => renderModule(m))}
          </div>
        ))}
      </div>

      {/* Profile/Footer */}
      <div className="p-3 bg-primary/5 border-t border-primary/5">
        <div className={`flex items-center gap-3 py-2 ${isCollapsed ? 'justify-center' : 'px-2'}`}>
          <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center text-secondary font-bold text-xs shrink-0 border border-primary/10">
            {user.name.charAt(0)}
          </div>
          {!isCollapsed && (
            <div className="flex-1 min-w-0 animate-in fade-in duration-300">
              <p className="text-xs font-black text-primary truncate leading-tight">{user.name}</p>
              <p className="text-[9px] font-bold text-primary/40 truncate uppercase tracking-tight">{user.email}</p>
            </div>
          )}
        </div>
        <div className={`mt-2 flex ${isCollapsed ? 'justify-center' : 'px-2'}`}>
           <LogoutButton
            variant="ghost"
            className="w-full text-primary/40 hover:text-primary flex items-center justify-center p-2 rounded-lg hover:bg-primary/10 transition-colors"
          />
        </div>
      </div>

    </aside>
    </>
  );
}
