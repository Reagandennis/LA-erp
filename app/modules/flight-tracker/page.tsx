'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useNow } from '@/app/ui/use-client';
import { formatDuration } from '@/lib/flight-status';
import { APP_LOCALE } from '@/lib/locale';
import { startVisibleInterval } from '@/lib/visible-interval';

import {
  type AircraftPhoto,
  type Bounds,
  DEFAULT_BOUNDS,
  type FlightRecord,
  MAX_AREA_SPAN_DEG,
  type Operator,
  SEARCH_META,
  SEARCH_PARAM,
  type SearchField,
  aircraftName,
  aircraftPhoto,
  compassPoint,
  countryName,
  etaInfo,
  flagEmoji,
  flightLabel,
  flightradarLink,
  formatNumber,
  ftToM,
  isOnGround,
  ktToKmh,
  operatorFor,
  phaseLabel,
  registrationCountry,
  routeProgress,
} from './flight-data';
import FlightMap, { type FrameRequest, type Insets, PLANE_PATH } from './flight-map';

/** Cards are tall; past this many a search or a closer zoom is the better tool. */
const MAX_CARDS = 80;

/**
 * FR24 bills 8 credits per flight returned, so the area list loads only when
 * asked (opening, searching, refreshing). The open flight alone stays live: one
 * single-flight lookup a minute, pausing after half an hour until resumed.
 */
const LIVE_REFRESH_MS = 60_000;
const LIVE_SESSION_MS = 30 * 60_000;

type LiveSession = { id: string; until: number; lost: boolean; fresh: boolean; updatedAt: string | null };

/** The narrowest worldwide lookup that finds this flight again. */
function liveLookup(f: FlightRecord): string | null {
  if (f.flight) return `flights=${encodeURIComponent(f.flight)}`;
  if (f.callsign) return `callsigns=${encodeURIComponent(f.callsign)}`;
  if (f.reg) return `registrations=${encodeURIComponent(f.reg)}`;
  return null;
}

async function fetchFlights(query: string): Promise<{ flights: FlightRecord[]; limit: number | null }> {
  const response = await fetch(`/api/flight-radar?${query}`, { credentials: 'include' });
  const data = (await response.json().catch(() => null)) as {
    flights?: FlightRecord[];
    limit?: number;
    error?: string;
  } | null;
  if (!response.ok) throw new Error(data?.error || 'Unable to load flight data.');
  return { flights: data?.flights ?? [], limit: data?.limit ?? null };
}

const clockLabel = () => new Date().toLocaleTimeString(APP_LOCALE, { hour: '2-digit', minute: '2-digit' });

type Trend = { key: 'steady' | 'later' | 'earlier' | 'none'; short: string; label: string };

/**
 * FR24 gives a live ETA but no schedule, so "late" can't be known. What can be
 * shown honestly is how the ETA has moved since this page first saw it.
 */
function etaTrend(flight: FlightRecord, baseline: ReadonlyMap<string, number>): Trend {
  const current = flight.eta ? Date.parse(flight.eta) : NaN;
  if (Number.isNaN(current)) return { key: 'none', short: '', label: 'No ETA' };
  const first = baseline.get(flight.id);
  const delta = first ? Math.round((current - first) / 60_000) : 0;
  if (delta >= 6) return { key: 'later', short: `+${delta}m`, label: `${delta} min later` };
  if (delta <= -6) return { key: 'earlier', short: `−${-delta}m`, label: `${-delta} min earlier` };
  return { key: 'steady', short: '', label: 'Steady' };
}

const trendClass: Record<Trend['key'], string> = {
  later: 'bg-rose-500/15 text-rose-300',
  earlier: 'bg-sky-500/15 text-sky-300',
  steady: 'text-white',
  none: 'text-white/45',
};

const areaTooLarge = (b: Bounds) => b.lamax - b.lamin > MAX_AREA_SPAN_DEG || b.lomax - b.lomin > MAX_AREA_SPAN_DEG;

export default function FlightTrackerPage() {
  const [flights, setFlights] = useState<FlightRecord[]>([]);
  // True until the first load completes; searches and refreshes set it again.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState('');
  // Most flights FR24 returns per lookup on this plan; a full page means more were cut off.
  const [responseLimit, setResponseLimit] = useState<number | null>(null);
  const [searchField, setSearchField] = useState<SearchField>('flight');
  const [searchValue, setSearchValue] = useState('');
  const [activeSearch, setActiveSearch] = useState<{ field: SearchField; value: string } | null>(null);
  const [area, setArea] = useState<Bounds>(DEFAULT_BOUNDS);
  // Set when the user pans or zooms away from what was last searched.
  const [movedTo, setMovedTo] = useState<Bounds | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [live, setLive] = useState<LiveSession | null>(null);
  const [follow, setFollow] = useState(false);
  const [frame, setFrame] = useState<FrameRequest | null>(null);
  // First ETA seen for each flight this session, to show how it has moved since.
  const [etaBaseline, setEtaBaseline] = useState<ReadonlyMap<string, number>>(() => new Map());
  const now = useNow(30_000);

  const requestFrame = useCallback(
    (kind: FrameRequest['kind']) => setFrame((current) => ({ kind, nonce: (current?.nonce ?? 0) + 1 })),
    [],
  );

  /** Open a flight and keep it live for a while. */
  const watch = useCallback((id: string) => {
    setSelectedId(id);
    setLive({ id, until: Date.now() + LIVE_SESSION_MS, lost: false, fresh: true, updatedAt: null });
  }, []);

  // After a search, frame its results (or open the one flight it found).
  const reframeAfterLoad = useRef(false);

  const query = activeSearch
    ? `${SEARCH_PARAM[activeSearch.field]}=${encodeURIComponent(activeSearch.value)}`
    : `lamin=${area.lamin}&lomin=${area.lomin}&lamax=${area.lamax}&lomax=${area.lomax}`;
  const [reloadNonce, setReloadNonce] = useState(0);

  const applyResult = useCallback(
    (next: FlightRecord[], limit: number | null) => {
      setResponseLimit(limit);
      setEtaBaseline((current) => {
        let updated: Map<string, number> | null = null;
        for (const f of next) {
          if (!f.eta || current.has(f.id)) continue;
          const t = Date.parse(f.eta);
          if (Number.isNaN(t)) continue;
          (updated ??= new Map(current)).set(f.id, t);
        }
        return updated ?? current;
      });
      setFlights(next);
      setError('');
      setLastUpdated(clockLabel());
      if (reframeAfterLoad.current) {
        reframeAfterLoad.current = false;
        if (next.length === 1) {
          watch(next[0].id);
          requestFrame('route');
        } else if (next.length > 1) {
          requestFrame('flights');
        }
      }
    },
    [requestFrame, watch],
  );

  // One lookup per area, search or refresh; no timer (see LIVE_REFRESH_MS).
  useEffect(() => {
    let active = true;
    fetchFlights(query)
      .then(({ flights: next, limit }) => {
        if (active) applyResult(next, limit);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : 'Unable to load flight data.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [query, reloadNonce, applyResult]);

  const refresh = () => {
    setLoading(true);
    setReloadNonce((n) => n + 1);
  };

  const submitSearch = () => {
    const value = searchValue.trim().toUpperCase();
    if (!value) return;
    reframeAfterLoad.current = true;
    setSelectedId(null);
    setLive(null);
    setFollow(false);
    setMovedTo(null);
    setLoading(true);
    setActiveSearch({ field: searchField, value });
    setReloadNonce((n) => n + 1); // Repeating the same search still looks again.
  };

  const clearSearch = () => {
    setSearchValue('');
    setActiveSearch(null);
    setSelectedId(null);
    setLive(null);
    setFollow(false);
    setMovedTo(null);
    setLoading(true);
    requestFrame('area');
  };

  const searchMovedArea = () => {
    if (!movedTo || areaTooLarge(movedTo)) return;
    setArea(movedTo);
    setMovedTo(null);
    setActiveSearch(null);
    setSearchValue('');
    setLoading(true);
    setReloadNonce((n) => n + 1);
  };

  const sorted = useMemo(
    () =>
      [...flights].sort(
        (a, b) => Number(isOnGround(a)) - Number(isOnGround(b)) || flightLabel(a).localeCompare(flightLabel(b)),
      ),
    [flights],
  );
  const selected = flights.find((f) => f.id === selectedId) ?? null;

  /* ------------------------------------------------------ the open flight, live */

  const liveQuery = selected ? liveLookup(selected) : null;
  const liveId = live && live.id === selectedId && !live.lost ? live.id : null;
  const liveUntil = live?.until ?? 0;
  const liveFresh = live?.fresh ?? true;

  useEffect(() => {
    if (!liveId || !liveQuery) return;
    const update = async () => {
      if (Date.now() > liveUntil) return; // Paused; the panel offers to resume.
      try {
        const { flights: found } = await fetchFlights(liveQuery);
        const match = found.find((f) => f.id === liveId);
        if (!match) {
          setLive((current) => (current?.id === liveId ? { ...current, lost: true } : current));
          return;
        }
        setFlights((current) => current.map((f) => (f.id === liveId ? match : f)));
        setLive((current) => (current?.id === liveId ? { ...current, updatedAt: clockLabel() } : current));
      } catch {
        // Try again on the next tick.
      }
    };
    // A resumed session is stale, so it updates straight away.
    return startVisibleInterval(() => void update(), LIVE_REFRESH_MS, { immediate: !liveFresh });
  }, [liveId, liveQuery, liveUntil, liveFresh]);

  const liveState: LiveState = !live || live.id !== selectedId ? 'off' : live.lost ? 'lost' : now !== null && now > live.until ? 'paused' : 'live';
  const resumeLive = () =>
    setLive((current) => (current ? { ...current, until: Date.now() + LIVE_SESSION_MS, fresh: false } : current));

  /* ------------------------------------------------- layout-aware map framing */

  const mapBoxRef = useRef<HTMLDivElement>(null);
  const listPanelRef = useRef<HTMLDivElement>(null);
  const detailPanelRef = useRef<HTMLDivElement>(null);

  // How much of the map each floating panel covers. On a phone the panels sit
  // below the map, so nothing overlaps and the insets are zero.
  const getInsets = useCallback((): Insets => {
    const insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
    const map = mapBoxRef.current?.getBoundingClientRect();
    if (!map) return insets;
    for (const panel of [listPanelRef.current, detailPanelRef.current]) {
      const r = panel?.getBoundingClientRect();
      if (!r || r.width === 0) continue;
      if (r.left >= map.right || r.right <= map.left || r.top >= map.bottom || r.bottom <= map.top) continue;
      if (r.left - map.left < map.right - r.right) insets.left = Math.max(insets.left, r.right - map.left);
      else insets.right = Math.max(insets.right, map.right - r.left);
    }
    return insets;
  }, []);

  const select = (id: string, from: 'list' | 'map') => {
    watch(id);
    if (from === 'list') requestFrame('plane');
  };
  const onMapSelect = useCallback((id: string) => watch(id), [watch]);
  const close = useCallback(() => {
    setSelectedId(null);
    setLive(null);
    setFollow(false);
  }, []);

  // On a phone the details sit between the map and the list; bring them into view.
  useEffect(() => {
    const panel = detailPanelRef.current;
    if (!selectedId || !panel || getComputedStyle(panel).position === 'absolute') return;
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key === 'Escape' && !target?.closest('input, select, textarea')) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, close]);

  const truncated = responseLimit !== null && flights.length >= responseLimit;

  const status = loading
    ? 'Loading flights…'
    : `${flights.length.toLocaleString(APP_LOCALE)} ${flights.length === 1 ? 'flight' : 'flights'} ${
        activeSearch ? 'found' : 'in this area'
      }${lastUpdated ? ` · ${lastUpdated}` : ''}`;

  return (
    <div className="screen-fit bg-[#0b0c0e] text-white" style={{ colorScheme: 'dark', fontFamily: 'var(--font-geist-sans), system-ui, sans-serif' }}>
      <div className="@container h-full overflow-y-auto">
        <div className="relative flex min-h-full flex-col gap-3 p-3 @5xl:block @5xl:h-full @5xl:p-0">
          {/* Map: the backdrop on wide screens, a block of its own on phones. */}
          <div
            ref={mapBoxRef}
            className="relative order-2 h-[58vh] min-h-80 overflow-hidden rounded-3xl @5xl:absolute @5xl:inset-0 @5xl:h-auto @5xl:rounded-none"
          >
            <FlightMap
              flights={flights}
              selected={selected}
              onSelect={onMapSelect}
              area={area}
              follow={follow}
              frame={frame}
              getInsets={getInsets}
              onUserMove={setMovedTo}
            />
            {movedTo && (
              <button
                type="button"
                onClick={searchMovedArea}
                disabled={areaTooLarge(movedTo)}
                className="absolute left-1/2 top-4 z-[1001] inline-flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full bg-[#151518]/95 px-4 py-2 text-sm font-semibold shadow-lg ring-1 ring-white/10 backdrop-blur transition-colors hover:bg-[#1f1f23] disabled:cursor-default disabled:text-white/55 disabled:hover:bg-[#151518]/95"
              >
                {areaTooLarge(movedTo) ? (
                  'Zoom in to search this area'
                ) : (
                  <>
                    <SearchIcon className="h-4 w-4 text-[#F9B232]" />
                    Search this area
                  </>
                )}
              </button>
            )}
          </div>

          {/* Search and the flight list: a floating column on wide screens. */}
          <div
            ref={listPanelRef}
            className="contents @5xl:absolute @5xl:left-4 @5xl:top-4 @5xl:z-10 @5xl:flex @5xl:max-h-[calc(100%-2rem)] @5xl:w-[21rem] @5xl:flex-col @5xl:gap-3 @7xl:w-[23rem]"
          >
            <section className="order-1 shrink-0 rounded-3xl bg-[#151518]/95 p-4 shadow-xl ring-1 ring-white/[0.06] backdrop-blur">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h1 className="text-lg font-semibold tracking-tight">Flight tracker</h1>
                  <p className="truncate text-xs text-white/50" aria-live="polite">
                    {status}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={refresh}
                  disabled={loading}
                  aria-label="Refresh flights"
                  title="Refresh"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
                >
                  <svg viewBox="0 0 24 24" className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
                  </svg>
                </button>
              </div>

              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  submitSearch();
                }}
                className="mt-3 flex items-center rounded-full bg-white/[0.06] ring-1 ring-white/10 transition focus-within:ring-[#F9B232]/60"
              >
                <label className="relative flex shrink-0 items-center">
                  <span className="sr-only">Search by</span>
                  <select
                    value={searchField}
                    onChange={(e) => setSearchField(e.target.value as SearchField)}
                    className="appearance-none bg-transparent py-2.5 pl-4 pr-7 text-xs font-semibold text-white/80 focus:outline-none"
                  >
                    {(Object.keys(SEARCH_META) as SearchField[]).map((field) => (
                      <option key={field} value={field} className="bg-[#151518] text-white">
                        {SEARCH_META[field].label}
                      </option>
                    ))}
                  </select>
                  <svg viewBox="0 0 24 24" className="pointer-events-none absolute right-2 h-3.5 w-3.5 text-white/45" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </label>
                <span className="h-5 w-px shrink-0 bg-white/10" />
                <input
                  value={searchValue}
                  onChange={(e) => setSearchValue(e.target.value)}
                  placeholder={SEARCH_META[searchField].placeholder}
                  aria-label={`Search by ${SEARCH_META[searchField].label.toLowerCase()}`}
                  autoCapitalize="characters"
                  spellCheck={false}
                  className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm text-white placeholder:text-white/35 focus:outline-none"
                />
                <button
                  type="submit"
                  aria-label="Search"
                  className="mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#F9B232] text-[#151518] transition-colors hover:bg-[#ffc24d]"
                >
                  <SearchIcon className="h-4 w-4" />
                </button>
              </form>

              {activeSearch && (
                <div className="mt-3 flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-white/55">
                    {SEARCH_META[activeSearch.field].label}{' '}
                    <span className="font-(family-name:--font-geist-mono) font-semibold text-white">{activeSearch.value}</span>
                    {' · worldwide'}
                  </span>
                  <button type="button" onClick={clearSearch} className="shrink-0 rounded-full px-2 py-1 font-semibold text-[#F9B232] hover:bg-white/[0.06]">
                    Clear
                  </button>
                </div>
              )}
              {error && (
                <p role="alert" className="mt-3 rounded-2xl bg-rose-500/15 px-3 py-2 text-sm text-rose-200">
                  {error}
                </p>
              )}
              {truncated && !loading && (
                <p className="mt-3 rounded-2xl bg-[#F9B232]/10 px-3 py-2 text-xs leading-relaxed text-[#F9B232]">
                  Showing the first {responseLimit} flights, the most the FlightRadar24 plan returns per lookup. Zoom in
                  or search to narrow it down.
                </p>
              )}
            </section>

            <div className="order-4 space-y-2.5 @5xl:-mr-2 @5xl:min-h-0 @5xl:flex-1 @5xl:overflow-y-auto @5xl:pb-1 @5xl:pr-2 [scrollbar-color:rgba(255,255,255,0.2)_transparent] [scrollbar-width:thin]">
              {loading && flights.length === 0 ? (
                Array.from({ length: 3 }, (_, i) => (
                  <div key={i} className="h-[8.5rem] animate-pulse rounded-2xl bg-[#151518]/90 ring-1 ring-white/[0.06]" />
                ))
              ) : flights.length === 0 ? (
                <p className="rounded-2xl bg-[#151518]/95 px-4 py-6 text-center text-sm text-white/55 ring-1 ring-white/[0.06]">
                  {activeSearch
                    ? `No live flights match ${activeSearch.value}. It may not be in the air yet.`
                    : 'No flights in this area right now. Move the map and search again, or look up a flight by number.'}
                </p>
              ) : (
                <>
                  {sorted.slice(0, MAX_CARDS).map((flight) => (
                    <FlightCard
                      key={flight.id}
                      flight={flight}
                      selected={flight.id === selectedId}
                      trend={etaTrend(flight, etaBaseline)}
                      onSelect={() => select(flight.id, 'list')}
                    />
                  ))}
                  {sorted.length > MAX_CARDS && (
                    <p className="px-2 py-1 text-center text-xs text-white/45">
                      Showing {MAX_CARDS} of {sorted.length}. Zoom in or search to narrow the list; every flight is on the map.
                    </p>
                  )}
                </>
              )}
            </div>
          </div>

          {selected && (
            <aside
              ref={detailPanelRef}
              aria-label={`Flight ${flightLabel(selected)}`}
              className="order-3 @5xl:absolute @5xl:right-4 @5xl:top-4 @5xl:z-10 @5xl:max-h-[calc(100%-2rem)] @5xl:w-[23rem] @5xl:overflow-y-auto @5xl:rounded-3xl @7xl:w-[25rem] [scrollbar-width:none]"
            >
              <FlightDetail
                flight={selected}
                trend={etaTrend(selected, etaBaseline)}
                now={now}
                liveState={liveState}
                liveUpdatedAt={live?.updatedAt ?? null}
                onResumeLive={resumeLive}
                follow={follow}
                onToggleFollow={() => setFollow((value) => !value)}
                onRoute={() => requestFrame('route')}
                onClose={close}
              />
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- cards */

const mono = 'font-(family-name:--font-geist-mono)';

function FlightCard({
  flight,
  selected,
  trend,
  onSelect,
}: {
  flight: FlightRecord;
  selected: boolean;
  trend: Trend;
  onSelect: () => void;
}) {
  const operator = operatorFor(flight);
  const progress = routeProgress(flight);
  const ground = isOnGround(flight);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`block w-full rounded-2xl bg-[#151518]/95 p-4 text-left shadow-lg backdrop-blur transition ${mono} ${
        selected ? 'ring-2 ring-[#EE6A3C]' : 'ring-1 ring-white/[0.06] hover:bg-[#1c1c20]'
      }`}
    >
      <div className="flex items-center gap-2.5">
        <OperatorBadge operator={operator} />
        <span className="min-w-0 flex-1 truncate text-[15px] font-medium tracking-wide">{flightLabel(flight)}</span>
        {ground && <Chip className="text-white/60">On ground</Chip>}
        {trend.short && <Chip className={trendClass[trend.key]}>{trend.short}</Chip>}
        {flight.type && <Chip>{flight.type}</Chip>}
        {flight.reg && <Chip className="hidden @sm:inline-flex @5xl:inline-flex">{flight.reg}</Chip>}
      </div>
      <div className="mt-4 flex justify-between gap-3 text-xs text-white/60">
        <span className="min-w-0 truncate">{flight.origin?.city ?? 'Unknown'}</span>
        <span className="min-w-0 truncate text-right">{flight.destination?.city ?? 'Unknown'}</span>
      </div>
      <div className="mt-1 flex items-center gap-3">
        <span className="text-[1.75rem] font-medium leading-none tracking-wide">{flight.origin?.iata ?? flight.origIata ?? '———'}</span>
        <ProgressTrack fraction={progress?.fraction ?? null} muted={ground} />
        <span className="text-[1.75rem] font-medium leading-none tracking-wide">{flight.destination?.iata ?? flight.destIata ?? '———'}</span>
      </div>
    </button>
  );
}

function OperatorBadge({ operator, size = 'sm' }: { operator: Operator; size?: 'sm' | 'lg' }) {
  return (
    <span
      title={operator.name}
      className={`flex shrink-0 items-center justify-center rounded-full font-bold ring-2 ring-white/10 ${mono} ${
        size === 'lg' ? 'h-11 w-11 text-sm' : 'h-8 w-8 text-[11px]'
      }`}
      style={{ background: operator.color, color: operator.ink }}
    >
      {operator.badge ?? <PlaneGlyph className={size === 'lg' ? 'h-5 w-5' : 'h-4 w-4'} />}
    </span>
  );
}

function Chip({ children, className = 'text-white/70' }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-md bg-white/[0.07] px-1.5 py-0.5 text-[11px] ${className}`}>
      {children}
    </span>
  );
}

/** Flown part in the brand gradient, the plane at its share of the distance. */
function ProgressTrack({ fraction, muted = false }: { fraction: number | null; muted?: boolean }) {
  const percent = fraction === null ? 50 : Math.min(96, Math.max(4, fraction * 100));
  return (
    <div className="relative h-6 min-w-0 flex-1" role="img" aria-label={fraction === null ? 'Progress unknown' : `${Math.round(fraction * 100)}% of the way`}>
      <span className={`absolute inset-x-0 top-1/2 -translate-y-1/2 border-t ${fraction === null ? 'border-dashed border-white/25' : 'border-white/15'}`} />
      {fraction !== null && (
        <span
          className="absolute left-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-linear-to-r from-[#E8483A] to-[#F9B232]"
          style={{ width: `${percent}%` }}
        />
      )}
      <PlaneGlyph
        className={`absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rotate-90 ${muted || fraction === null ? 'text-white/45' : 'text-white'}`}
        style={{ left: `${percent}%` }}
      />
    </div>
  );
}

/* --------------------------------------------------------------------- detail */

type LiveState = 'off' | 'live' | 'paused' | 'lost';

function FlightDetail({
  flight,
  trend,
  now,
  liveState,
  liveUpdatedAt,
  onResumeLive,
  follow,
  onToggleFollow,
  onRoute,
  onClose,
}: {
  flight: FlightRecord;
  trend: Trend;
  now: number | null;
  liveState: LiveState;
  liveUpdatedAt: string | null;
  onResumeLive: () => void;
  follow: boolean;
  onToggleFollow: () => void;
  onRoute: () => void;
  onClose: () => void;
}) {
  const operator = operatorFor(flight);
  const progress = routeProgress(flight);
  const eta = etaInfo(flight.eta, now ?? 0);
  const minutesLeft = now !== null && eta.minutes !== null && eta.minutes > 0 ? eta.minutes : null;
  const regCountry = registrationCountry(flight.reg);
  const link = flightradarLink(flight);
  const [copied, setCopied] = useState(false);

  const share = async () => {
    const route = `${flight.origin?.iata ?? flight.origIata ?? '?'} → ${flight.destination?.iata ?? flight.destIata ?? '?'}`;
    const text = [
      `${flightLabel(flight)} · ${operator.name}`,
      route,
      [eta.time !== '—' ? `ETA ${eta.time}` : null, phaseLabel(flight), flight.altFt ? `${formatNumber(flight.altFt)} ft` : null]
        .filter(Boolean)
        .join(' · '),
    ].join('\n');
    if (navigator.share) {
      try {
        await navigator.share({ title: flightLabel(flight), text, url: link ?? undefined });
      } catch {
        // Dismissed share sheet.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(link ? `${text}\n${link}` : text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked; nothing useful to add.
    }
  };

  return (
    <div className={`space-y-2 rounded-3xl bg-[#101012]/95 p-2.5 shadow-2xl ring-1 ring-white/[0.06] backdrop-blur ${mono}`}>
      <div className="flex items-center gap-3 rounded-2xl bg-black/45 px-4 py-3">
        <OperatorBadge operator={operator} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-2xl font-medium tracking-wide text-[#F9B232]">{flightLabel(flight)}</p>
          <p className="truncate text-sm text-white/75">{operator.name}</p>
          <LiveBadge state={liveState} updatedAt={liveUpdatedAt} onResume={onResumeLive} />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close flight details"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>

      <PhotoBlock flight={flight} operator={operator} />

      <div className="relative grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-white/[0.06]">
        {([flight.origin, flight.destination] as const).map((airport, i) => {
          const code = airport?.iata ?? (i === 0 ? flight.origIata : flight.destIata);
          return (
            <div key={i} className="min-w-0 bg-[#1a1a1d] px-3 py-4 text-center" title={airport?.name}>
              <p className="text-4xl font-medium tracking-wider">{code ?? '———'}</p>
              <p className="mt-1.5 truncate text-sm text-white/85">{airport?.city ?? 'Unknown airport'}</p>
              <p className="truncate text-xs text-white/40">{airport ? countryName(airport.country) : '—'}</p>
            </div>
          );
        })}
        <span className="absolute left-1/2 top-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[#101012] ring-1 ring-white/[0.08]">
          <PlaneGlyph className="h-5 w-5 rotate-90 text-[#F9B232]" />
        </span>
      </div>

      <div className="rounded-2xl bg-[#1a1a1d] px-4 py-3">
        <ProgressTrack fraction={progress?.fraction ?? null} muted={isOnGround(flight)} />
        <div className="mt-1 flex justify-between gap-3 text-xs text-white/50">
          <span>{progress ? `${formatNumber(progress.flownKm)} km flown` : 'Route unknown'}</span>
          <span className="text-right">
            {progress ? `${formatNumber(progress.remainingKm)} km` : ''}
            {progress && minutesLeft !== null ? ' · ' : ''}
            {minutesLeft !== null ? formatDuration(minutesLeft * 60_000) : ''}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-white/[0.06] text-sm">
        <Cell label="ETA" value={eta.time} />
        <Cell label="Lands in" value={minutesLeft !== null ? formatDuration(minutesLeft * 60_000) : '—'} />
        <Cell
          label="ETA moved"
          value={trend.key === 'later' || trend.key === 'earlier' ? trend.short : trend.label}
          valueClass={trend.key === 'later' ? 'text-rose-300' : trend.key === 'earlier' ? 'text-sky-300' : undefined}
          title="Compared with the first ETA seen since this page was opened"
        />
        <Cell
          label="Phase"
          value={phaseLabel(flight)}
          title={[
            flight.vspeedFpm === null ? null : `${flight.vspeedFpm > 0 ? '+' : ''}${formatNumber(flight.vspeedFpm)} fpm`,
            flight.track === null ? null : `heading ${Math.round(flight.track)}° ${compassPoint(flight.track)}`,
          ]
            .filter(Boolean)
            .join(', ') || undefined}
        />
      </div>

      <div className="overflow-hidden rounded-2xl bg-white/[0.06] text-sm">
        <p className="bg-[#1f1f23] px-4 py-2.5 text-white/85">Flight information</p>
        <div className="grid grid-cols-2 gap-px pt-px">
          <div className="min-w-0 truncate bg-[#1a1a1d] px-4 py-3" title={flight.type ?? undefined}>
            {aircraftName(flight.type)}
          </div>
          <div className="min-w-0 truncate bg-[#1a1a1d] px-4 py-3" title={flight.reg ?? undefined}>
            {regCountry ? (
              <>
                <span className="mr-2" aria-hidden="true">
                  {flagEmoji(regCountry)}
                </span>
                {countryName(regCountry)}
              </>
            ) : (
              (flight.reg ?? 'Unregistered')
            )}
          </div>
          <Cell
            label="Speed"
            value={flight.gspeedKt === null ? '—' : `${formatNumber(ktToKmh(flight.gspeedKt))} km/h`}
            title={flight.gspeedKt === null ? undefined : `${formatNumber(flight.gspeedKt)} kt`}
          />
          <Cell
            label="Altitude"
            value={flight.altFt === null ? '—' : `${formatNumber(flight.altFt)} ft`}
            title={flight.altFt === null ? undefined : `${formatNumber(ftToM(flight.altFt))} m`}
          />
        </div>
      </div>

      {/* Kept in reach while the details scroll on a short screen. */}
      <div className="sticky bottom-0 -mx-2.5 -mb-2.5 rounded-b-3xl bg-[#101012] px-2.5 pb-2.5 before:pointer-events-none before:absolute before:inset-x-0 before:-top-4 before:h-4 before:bg-linear-to-t before:from-[#101012] before:to-transparent">
        <div className="grid grid-cols-4 gap-px overflow-hidden rounded-2xl bg-white/[0.06] text-xs">
          <ActionButton label="Route" onClick={onRoute}>
            <path d="M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
            <path d="M8 17h7.5a3.5 3.5 0 0 0 0-7h-7a3.5 3.5 0 0 1 0-7H16" />
          </ActionButton>
          <ActionButton label={follow ? 'Following' : 'Follow'} onClick={onToggleFollow} pressed={follow}>
            <circle cx="12" cy="12" r="7" />
            <circle cx="12" cy="12" r="2.5" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          </ActionButton>
          <ActionButton label={copied ? 'Copied' : 'Share'} onClick={share}>
            <path d="M12 15V3M8 7l4-4 4 4" />
            <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
          </ActionButton>
          {link ? (
            <a href={link} target="_blank" rel="noopener noreferrer" className={actionClass} title="Open on Flightradar24">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M14 4h6v6M20 4l-9 9" />
                <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
              </svg>
              FR24
            </a>
          ) : (
            <span className={`${actionClass} text-white/30`}>FR24</span>
          )}
        </div>
      </div>
    </div>
  );
}

function LiveBadge({ state, updatedAt, onResume }: { state: LiveState; updatedAt: string | null; onResume: () => void }) {
  if (state === 'live') {
    return (
      <p className="mt-1 flex items-center gap-1.5 text-[11px] text-emerald-300" title="One lookup a minute (8 credits) while this panel is open">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400 motion-reduce:animate-none" />
        Live{updatedAt ? ` · updated ${updatedAt}` : ' · updates every minute'}
      </p>
    );
  }
  if (state === 'paused') {
    return (
      <button type="button" onClick={onResume} className="mt-1 text-left text-[11px] text-[#F9B232] hover:underline">
        Paused to save credits · Resume
      </button>
    );
  }
  if (state === 'lost') return <p className="mt-1 text-[11px] text-white/45">No longer in the live feed</p>;
  return null;
}

function Cell({ label, value, valueClass, title }: { label: string; value: string; valueClass?: string; title?: string }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 bg-[#1a1a1d] px-4 py-3" title={title}>
      <span className="text-white/45">{label}</span>
      {/* Wraps under its label rather than truncating when the panel is narrow. */}
      <span className={`ml-auto text-right ${valueClass ?? 'text-white'}`}>{value}</span>
    </div>
  );
}

const actionClass =
  'flex flex-col items-center gap-1.5 bg-[#1a1a1d] px-2 py-3 text-white/85 transition-colors hover:bg-[#232327] hover:text-white';

function ActionButton({
  label,
  onClick,
  pressed,
  children,
}: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className={`${actionClass} ${pressed ? 'text-[#F9B232] hover:text-[#F9B232]' : ''}`}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {children}
      </svg>
      {label}
    </button>
  );
}

/** The airframe's photo from Planespotters.net, credited as its terms require. */
function PhotoBlock({ flight, operator }: { flight: FlightRecord; operator: Operator }) {
  const key = `${flight.hex ?? ''}|${flight.reg ?? ''}`;
  const [result, setResult] = useState<{ key: string; photo: AircraftPhoto | null } | null>(null);
  useEffect(() => {
    let active = true;
    aircraftPhoto(flight.hex, flight.reg).then((photo) => {
      if (active) setResult({ key, photo });
    });
    return () => {
      active = false;
    };
  }, [flight.hex, flight.reg, key]);
  const loading = result?.key !== key;
  const photo = loading ? null : result.photo;

  return (
    <div className="relative h-44 overflow-hidden rounded-2xl bg-linear-to-b from-[#5F82C4] to-[#A8BFE6]">
      {photo ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- third-party thumbnail, shown as served */}
          <img src={photo.src} alt={`${flight.reg ?? 'Aircraft'}, ${aircraftName(flight.type)}`} className="h-full w-full object-cover" />
          <a
            href={photo.link}
            target="_blank"
            rel="noopener noreferrer"
            className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)] truncate rounded-md bg-black/55 px-2 py-1 text-[10px] text-white/85 backdrop-blur hover:text-white"
          >
            © {photo.photographer} · Planespotters.net
          </a>
        </>
      ) : (
        <div className={`flex h-full flex-col items-center justify-center gap-2 ${loading ? 'animate-pulse' : ''}`}>
          <PlaneGlyph className="h-16 w-16 rotate-45 drop-shadow-[0_10px_18px_rgba(10,25,60,0.35)]" style={{ color: operator.color }} />
          {!loading && <p className="text-xs font-medium text-[#10213f]/70">{aircraftName(flight.type)} · no photo yet</p>}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- icons */

function PlaneGlyph({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" className={className} style={style} fill="currentColor" aria-hidden="true">
      <path d={PLANE_PATH} />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
