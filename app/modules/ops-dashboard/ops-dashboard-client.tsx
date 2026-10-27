'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { formatNumber, formatTotals } from '@/app/modules/_components/fleet-ui';
import { subscribeServerEvents } from '@/app/ui/messaging-alerts-store';
import { moduleIcon } from '@/app/ui/module-icons';
import { useNow } from '@/app/ui/use-client';
import { APP_LOCALE } from '@/lib/locale';
import type { OpsDashboard, OpsReference, OpsSections } from '@/lib/ops-dashboard';
import { type OpsPanelKey, PANEL_ICON, PANEL_TITLE } from '@/lib/ops-panels';
import { startVisibleInterval } from '@/lib/visible-interval';

import AttentionBar from './attention-bar';
import { DEFAULT_LAYOUT, type OpsLayout, updateLayout, useIsFullscreen, useOpsLayout } from './board-stores';
import { FuelPanel, MaintenancePanel } from './fleet-panels';
import FlightsPanel from './flights-panel';
import HandoverPanel from './handover-panel';
import MovementsPanel from './movements-panel';
import { byCountry, countriesIn, movementState } from './ops-model';
import type { PanelFrame } from './ops-ui';
import TasksPanel from './tasks-panel';
import TripsPanel from './trips-panel';
import WhatsappPanel from './whatsapp-panel';

/** The panels on screen re-read this often while the tab is visible. */
const REFRESH_MS = 60_000;
/** A burst of incoming messages refreshes WhatsApp once, this long after the first. */
const MESSAGE_SETTLE_MS = 3_000;

/** What a change made on one panel can alter elsewhere, so only those reload. */
const TOUCHES: Record<OpsPanelKey, OpsPanelKey[]> = {
  movements: ['movements', 'trips', 'flights'],
  trips: ['trips', 'movements', 'flights'],
  flights: ['flights', 'movements', 'trips'],
  whatsapp: ['whatsapp'],
  handover: ['handover'],
  tasks: ['tasks'],
  maintenance: ['maintenance'],
  fuel: ['fuel'],
};

const NO_SIZE = {};

const toggled = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

// ---------------------------------------------------------------- header pieces

function LiveClock() {
  const now = useNow(1000);
  return (
    <div className="text-right" aria-live="off">
      <p className="font-mono text-2xl font-bold tabular-nums leading-none text-primary">
        {now === null ? '--:--:--' : new Date(now).toLocaleTimeString(APP_LOCALE, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
      </p>
      <p className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
        {now === null ? '' : new Date(now).toLocaleDateString(APP_LOCALE, { weekday: 'long', day: 'numeric', month: 'short' })}
      </p>
    </div>
  );
}

function UpdatedAgo({ at, failed }: Readonly<{ at: string; failed: boolean }>) {
  const now = useNow(5000);
  const seconds = now === null ? 0 : Math.max(0, Math.round((now - new Date(at).getTime()) / 1000));
  const since = seconds < 60 ? `${seconds}s ago` : `${Math.floor(seconds / 60)} min ago`;
  return (
    <span className="flex items-center gap-1.5 text-xs text-gray-500">
      <span className={`h-2 w-2 rounded-full ${failed ? 'bg-amber-400' : 'animate-pulse bg-emerald-500'}`} aria-hidden="true" />
      {now === null ? 'Live' : failed ? `Couldn’t refresh · data from ${since}` : `Live · updated ${since}`}
    </span>
  );
}

const toolButton =
  'flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-primary transition-colors hover:border-primary/30 disabled:opacity-60';

function CustomizeMenu({
  allowed,
  layout,
  onShow,
}: Readonly<{ allowed: OpsPanelKey[]; layout: OpsLayout; onShow: (panels?: OpsPanelKey[]) => void }>) {
  const [open, setOpen] = useState(false);
  const panels = layout.order.filter((key) => allowed.includes(key));

  const move = (key: OpsPanelKey, step: -1 | 1) =>
    updateLayout((l) => {
      const mine = l.order.filter((k) => allowed.includes(k));
      const other = mine[mine.indexOf(key) + step];
      if (!other) return l;
      const order = [...l.order];
      const a = order.indexOf(key);
      const b = order.indexOf(other);
      [order[a], order[b]] = [order[b]!, order[a]!];
      return { ...l, order };
    });

  const toggleHidden = (key: OpsPanelKey) => {
    const showing = layout.hidden.includes(key);
    updateLayout((l) => ({ ...l, hidden: toggled(l.hidden, key) }));
    // A panel coming back has been left alone since it was hidden.
    if (showing) onShow([key]);
  };

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={toolButton}>
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
        </svg>
        Customize
      </button>
      {open && (
        <>
          <button type="button" aria-label="Close" className="fixed inset-0 z-30 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-40 mt-2 w-72 rounded-2xl border border-gray-100 bg-white p-2 shadow-xl">
            <p className="px-2 pb-1 pt-1 text-[10px] font-bold uppercase tracking-[0.15em] text-gray-400">Panels · this browser</p>
            <ul>
              {panels.map((key, i) => {
                const shown = !layout.hidden.includes(key);
                return (
                  <li key={key} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50">
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm font-semibold text-gray-800">
                      <input type="checkbox" checked={shown} onChange={() => toggleHidden(key)} className="h-4 w-4 rounded border-gray-300 accent-[#03458f]" />
                      <span className="text-primary [&_svg]:h-4 [&_svg]:w-4">{moduleIcon(PANEL_ICON[key])}</span>
                      <span className="truncate">{PANEL_TITLE[key]}</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => move(key, -1)}
                      disabled={i === 0}
                      aria-label={`Move ${PANEL_TITLE[key]} up`}
                      className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-primary disabled:opacity-30"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => move(key, 1)}
                      disabled={i === panels.length - 1}
                      aria-label={`Move ${PANEL_TITLE[key]} down`}
                      className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-primary disabled:opacity-30"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="px-2 pb-2 pt-1 text-[11px] leading-snug text-gray-400">
              Drag a panel’s bottom-right corner to resize it; double-click the corner to reset it.
            </p>
            <div className="mt-1 flex items-center gap-3 border-t border-gray-100 px-2 pt-2">
              <button
                type="button"
                onClick={() => updateLayout((l) => ({ ...l, collapsed: l.collapsed.length > 0 ? [] : [...panels] }))}
                className="text-xs font-bold text-primary hover:underline"
              >
                {layout.collapsed.length > 0 ? 'Unfold all' : 'Fold all'}
              </button>
              <button
                type="button"
                onClick={() => updateLayout((l) => ({ ...l, sizes: {} }))}
                disabled={Object.keys(layout.sizes).length === 0}
                className="text-xs font-bold text-primary hover:underline disabled:text-gray-300 disabled:no-underline"
              >
                Reset sizes
              </button>
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => {
                  updateLayout(() => DEFAULT_LAYOUT);
                  onShow(allowed);
                }}
                className="text-xs font-bold text-gray-500 hover:text-primary"
              >
                Reset
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- summary tiles

type Tile = { key: OpsPanelKey; label: string; value: string; hint?: string; alert?: boolean };

function SummaryTiles({ sections, visible }: Readonly<{ sections: Partial<OpsSections>; visible: OpsPanelKey[] }>) {
  const now = useNow(30_000);
  const { movements, trips, flights, whatsapp, handover, tasks, maintenance, fuel } = sections;
  const late = now === null ? 0 : (movements ?? []).filter((m) => movementState(m, now) === 'late').length;

  const tiles: Record<OpsPanelKey, Tile | null> = {
    movements: movements
      ? { key: 'movements', label: 'Movements open', value: String(movements.filter((m) => !m.completed).length), hint: `${late} late`, alert: late > 0 }
      : null,
    trips: trips ? { key: 'trips', label: 'Trips active', value: String(trips.active), hint: `${trips.startingSoon} starting soon` } : null,
    flights: flights ? { key: 'flights', label: 'Flights · 36h', value: String(flights.filter((f) => !f.completed).length) } : null,
    whatsapp: whatsapp ? { key: 'whatsapp', label: 'Unread chats', value: String(whatsapp.unreadChats), alert: whatsapp.unreadChats > 0 } : null,
    handover: handover ? { key: 'handover', label: 'Handovers', value: String(handover.awaiting), hint: 'to acknowledge' } : null,
    tasks: tasks ? { key: 'tasks', label: 'Open tasks', value: String(tasks.open), hint: `${tasks.overdue} overdue`, alert: tasks.overdue > 0 } : null,
    maintenance: maintenance
      ? {
          key: 'maintenance',
          label: 'Maintenance due',
          value: String(maintenance.overdue + maintenance.dueSoon),
          hint: `${maintenance.overdue} overdue`,
          alert: maintenance.overdue > 0,
        }
      : null,
    fuel: fuel ? { key: 'fuel', label: 'Fuel · month', value: formatTotals(fuel.month.spend), hint: `${formatNumber(fuel.month.litres, 1)} L` } : null,
  };
  const shown = visible.map((key) => tiles[key]).filter((t): t is Tile => t !== null);
  if (shown.length === 0) return null;

  return (
    <nav aria-label="Summary" className="grid grid-cols-2 gap-3 sm:grid-cols-4 2xl:grid-cols-8">
      {shown.map((tile) => (
        <a
          key={tile.key}
          href={`#ops-${tile.key}`}
          className="group min-w-0 rounded-2xl border border-gray-100 bg-white p-3.5 shadow-sm transition-colors hover:border-secondary"
        >
          <p className="flex items-center gap-1.5 truncate text-[10px] font-bold uppercase tracking-[0.12em] text-gray-400">
            <span className="shrink-0 text-gray-300 group-hover:text-primary [&_svg]:h-3.5 [&_svg]:w-3.5">{moduleIcon(PANEL_ICON[tile.key])}</span>
            {tile.label}
          </p>
          <p className={`mt-1 truncate text-2xl font-bold tabular-nums ${tile.alert ? 'text-rose-600' : 'text-primary'}`} title={tile.value}>
            {tile.value}
          </p>
          {tile.hint && <p className="truncate text-xs text-gray-500">{tile.hint}</p>}
        </a>
      ))}
    </nav>
  );
}

// ---------------------------------------------------------------- the board

export default function OpsDashboardClient({
  initial,
  reference,
}: Readonly<{ initial: OpsDashboard; reference: OpsReference | null }>) {
  const [sections, setSections] = useState<Partial<OpsSections>>(initial.sections);
  const [allowed, setAllowed] = useState(initial.allowed);
  const [updatedAt, setUpdatedAt] = useState(initial.generatedAt);
  const [loading, setLoading] = useState<ReadonlySet<OpsPanelKey>>(() => new Set());
  const [failed, setFailed] = useState(false);
  // Bumped when a message arrives, so an open WhatsApp chat reloads too.
  const [messagingVersion, setMessagingVersion] = useState(0);
  const layout = useOpsLayout();
  const fullscreen = useIsFullscreen();
  const rootRef = useRef<HTMLElement>(null);
  const counter = useRef(0);
  const latest = useRef<Partial<Record<OpsPanelKey, number>>>({});

  const visible = layout.order.filter((key) => allowed.includes(key) && !layout.hidden.includes(key));
  // The poll asks for what is on screen now, without restarting its timer.
  const visibleRef = useRef(visible);
  useEffect(() => {
    visibleRef.current = visible;
  });

  /**
   * Reload some panels (by default the ones on screen). Each panel takes the
   * answer of the request that asked for it last, so a slow poll never
   * overwrites a change just made; a panel whose data didn't change keeps it
   * as it was and doesn't redraw.
   */
  const refresh = useCallback(async (panels?: readonly OpsPanelKey[]) => {
    const wanted = panels ?? visibleRef.current;
    if (wanted.length === 0) return;
    const id = ++counter.current;
    for (const key of wanted) latest.current[key] = id;
    const current = () => wanted.filter((key) => latest.current[key] === id);
    setLoading((was) => new Set([...was, ...wanted]));
    try {
      const response = await fetch(`/api/dashboard/ops?panels=${wanted.join(',')}`, { credentials: 'include', cache: 'no-store' });
      if (!response.ok) throw new Error(`Refresh failed (${response.status})`);
      const { dashboard } = (await response.json()) as { dashboard: OpsDashboard };
      const keys = current();
      setSections((was) => {
        let next = was;
        for (const key of keys) {
          const fresh = dashboard.sections[key];
          if (fresh === undefined || JSON.stringify(fresh) === JSON.stringify(was[key])) continue;
          next = { ...next, [key]: fresh };
        }
        return next;
      });
      setAllowed((was) => (was.join() === dashboard.allowed.join() ? was : dashboard.allowed));
      setUpdatedAt(dashboard.generatedAt);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      const settled = current();
      setLoading((was) => {
        const next = new Set(was);
        for (const key of settled) next.delete(key);
        return next;
      });
    }
  }, []);

  useEffect(() => startVisibleInterval(() => void refresh(), REFRESH_MS), [refresh]);

  const watchingWhatsapp = visible.includes('whatsapp');
  useEffect(() => {
    if (!watchingWhatsapp) return;
    let timer: number | null = null;
    const unsubscribe = subscribeServerEvents('messaging', () => {
      if (timer !== null) return;
      timer = window.setTimeout(() => {
        timer = null;
        setMessagingVersion((v) => v + 1);
        void refresh(['whatsapp']);
      }, MESSAGE_SETTLE_MS);
    });
    return () => {
      unsubscribe();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [watchingWhatsapp, refresh]);

  // R refreshes, unless you're typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'r' || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      e.preventDefault();
      void refresh();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [refresh]);

  const toggleWallDisplay = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void rootRef.current?.requestFullscreen().catch(() => {});
  };

  const countries = countriesIn(sections);
  if (layout.country && !countries.includes(layout.country)) countries.push(layout.country);
  const shown = byCountry(sections, layout.country);
  // The attention bar and tiles only speak for panels on screen: hidden ones aren't kept fresh.
  const onScreen = Object.fromEntries(visible.map((key) => [key, shown[key]])) as Partial<OpsSections>;

  const frame = (key: OpsPanelKey): PanelFrame => ({
    collapsed: layout.collapsed.includes(key),
    loading: loading.has(key),
    onToggleCollapse: () => updateLayout((l) => ({ ...l, collapsed: toggled(l.collapsed, key) })),
    size: layout.sizes[key] ?? NO_SIZE,
    onResize: (size) =>
      updateLayout((l) => {
        const sizes = { ...l.sizes };
        if (size) sizes[key] = size;
        else delete sizes[key];
        return { ...l, sizes };
      }),
  });
  const changed = (key: OpsPanelKey) => () => refresh(TOUCHES[key]);

  const panel = (key: OpsPanelKey) => {
    switch (key) {
      case 'movements':
        return shown.movements && <MovementsPanel key={key} movements={shown.movements} frame={frame(key)} onChanged={changed(key)} />;
      case 'trips':
        return shown.trips && <TripsPanel key={key} data={shown.trips} flights={shown.flights ?? []} frame={frame(key)} onChanged={changed(key)} />;
      case 'flights':
        return (
          shown.flights && (
            <FlightsPanel key={key} flights={shown.flights} canOpenFlightTracker={initial.canOpenFlightTracker} frame={frame(key)} onChanged={changed(key)} />
          )
        );
      case 'whatsapp':
        return shown.whatsapp && <WhatsappPanel key={key} data={shown.whatsapp} version={messagingVersion} frame={frame(key)} onChanged={changed(key)} />;
      case 'handover':
        return shown.handover && <HandoverPanel key={key} data={shown.handover} frame={frame(key)} onChanged={changed(key)} />;
      case 'tasks':
        return shown.tasks && <TasksPanel key={key} data={shown.tasks} frame={frame(key)} onChanged={changed(key)} />;
      case 'maintenance':
        return shown.maintenance && reference && <MaintenancePanel key={key} data={shown.maintenance} reference={reference} frame={frame(key)} onChanged={changed(key)} />;
      case 'fuel':
        return shown.fuel && reference && <FuelPanel key={key} data={shown.fuel} reference={reference} frame={frame(key)} onChanged={changed(key)} />;
    }
  };

  return (
    <main
      ref={rootRef}
      className={`min-h-full space-y-5 bg-gray-50 p-4 sm:p-6 lg:p-8 [&:fullscreen]:overflow-y-auto ${fullscreen ? 'lg:p-10' : ''}`}
    >
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-primary">Ops dashboard</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            The day&apos;s movements, trips, flights, messages, handovers, tasks and fleet. Act here, or expand a panel to open its module.
          </p>
          <div className="mt-3">
            <UpdatedAgo at={updatedAt} failed={failed} />
          </div>
        </div>
        <div className="flex flex-col items-end gap-3">
          <LiveClock />
          <div className="flex flex-wrap items-center justify-end gap-2">
            {countries.length > 0 && (
              <select
                value={layout.country}
                onChange={(e) => updateLayout((l) => ({ ...l, country: e.target.value }))}
                aria-label="Country"
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-primary focus:outline-none focus:ring-2 focus:ring-primary/15"
              >
                <option value="">All countries</option>
                {countries.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            )}
            {allowed.length > 0 && <CustomizeMenu allowed={allowed} layout={layout} onShow={(panels) => void refresh(panels)} />}
            <button type="button" onClick={toggleWallDisplay} className={toolButton} title="Full screen, for a wall or second monitor">
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d={fullscreen ? 'M9 9H4V4m11 5h5V4M9 15H4v5m11-5h5v5' : 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'}
                />
              </svg>
              {fullscreen ? 'Exit wall display' : 'Wall display'}
            </button>
            <button type="button" onClick={() => void refresh()} disabled={loading.size > 0} className={toolButton} title="Refresh (R)">
              <svg className={`h-3.5 w-3.5 ${loading.size > 0 ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              Refresh
            </button>
          </div>
        </div>
      </header>

      {allowed.length === 0 ? (
        <div className="rounded-3xl border-2 border-dashed border-gray-200 bg-white p-12 text-center">
          <h2 className="text-lg font-bold text-primary">Nothing to show yet</h2>
          <p className="mt-1 text-sm text-gray-500">
            Panels appear for the modules you hold: Trip Planning, WhatsApp, Handover, Tasks, Car Fuel and Car Maintenance. Ask your administrator for access.
          </p>
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-3xl border-2 border-dashed border-gray-200 bg-white p-12 text-center">
          <h2 className="text-lg font-bold text-primary">Every panel is hidden</h2>
          <p className="mt-1 text-sm text-gray-500">Use Customize to choose the panels you want on this screen.</p>
        </div>
      ) : (
        <>
          <AttentionBar sections={onScreen} />
          <SummaryTiles sections={onScreen} visible={visible} />
          <div className="grid grid-flow-row-dense grid-cols-1 items-start gap-5 xl:grid-cols-2 2xl:grid-cols-3">{visible.map(panel)}</div>
        </>
      )}
    </main>
  );
}
