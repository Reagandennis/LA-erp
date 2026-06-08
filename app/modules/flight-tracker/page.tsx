'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type FlightRecord = {
  id: string;
  flight: string | null;
  callsign: string | null;
  hex: string | null;
  lat: number | null;
  lon: number | null;
  track: number | null;
  altFt: number | null;
  gspeedKt: number | null;
  vspeedFpm: number | null;
  type: string | null;
  reg: string | null;
  airline: string | null;
  origIata: string | null;
  origIcao: string | null;
  destIata: string | null;
  destIcao: string | null;
  eta: string | null;
};

type Bounds = { lamin: string; lomin: string; lamax: string; lomax: string };
const DEFAULT_BOUNDS: Bounds = { lamin: '-4.9', lomin: '33.9', lamax: '5.2', lomax: '41.9' };

type SearchField = 'flight' | 'callsign' | 'airline' | 'airport' | 'registration';
const SEARCH_PARAM: Record<SearchField, string> = {
  flight: 'flights',
  callsign: 'callsigns',
  airline: 'airline',
  airport: 'airport',
  registration: 'registrations',
};
const SEARCH_META: Record<SearchField, { label: string; placeholder: string }> = {
  flight: { label: 'Flight no.', placeholder: 'e.g. QR1399, BA117' },
  callsign: { label: 'Callsign', placeholder: 'e.g. QTR1399' },
  airline: { label: 'Airline (ICAO)', placeholder: 'e.g. QTR, KQA, BAW' },
  airport: { label: 'Airport', placeholder: 'IATA/ICAO e.g. DOH, NBO' },
  registration: { label: 'Registration', placeholder: 'e.g. A7-BHA, 5Y-CYB' },
};

const numFmt = (n: number | null) => (n === null ? '—' : Math.round(n).toLocaleString());
const trackDeg = (t: number | null) => (t === null ? '—' : `${Math.round(t)}°`);
const vRate = (n: number | null) => (n === null ? '—' : `${n > 0 ? '+' : ''}${Math.round(n).toLocaleString()}`);

const isOnGround = (f: FlightRecord) => (f.altFt ?? 99999) < 150 && (f.gspeedKt ?? 0) < 50;
const motionLabel = (f: FlightRecord) => {
  if (isOnGround(f)) return 'On ground';
  const vr = f.vspeedFpm ?? 0;
  if (vr > 120) return 'Climbing';
  if (vr < -120) return 'Descending';
  return 'Cruising';
};

const AIRCRAFT_NAMES: Record<string, string> = {
  B789: 'Boeing 787-9', B788: 'Boeing 787-8', B78X: 'Boeing 787-10',
  B738: 'Boeing 737-800', B38M: 'Boeing 737 MAX 8', B77W: 'Boeing 777-300ER', B763: 'Boeing 767-300',
  A320: 'Airbus A320', A321: 'Airbus A321', A21N: 'Airbus A321neo', A20N: 'Airbus A320neo',
  A332: 'Airbus A330-200', A333: 'Airbus A330-300', A359: 'Airbus A350-900', A35K: 'Airbus A350-1000', A388: 'Airbus A380-800',
  E190: 'Embraer E190', E195: 'Embraer E195', AT76: 'ATR 72-600', DH8D: 'Dash 8 Q400',
};
const aircraftName = (code: string | null) => (code ? AIRCRAFT_NAMES[code] ?? code : '—');

const etaInfo = (iso: string | null) => {
  if (!iso) return { mins: null as number | null, time: '—' };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { mins: null, time: '—' };
  const mins = Math.round((d.getTime() - Date.now()) / 60000);
  return { mins, time: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
};

type ArrivalKey = 'ontime' | 'delayed' | 'early' | 'none';
type Arrival = { key: ArrivalKey; label: string };

// Dark badge styles for the card, light dot colour for the list.
const arrivalBadgeCls: Record<ArrivalKey, string> = {
  ontime: 'border-emerald-400/40 bg-emerald-500/15 text-emerald-300 shadow-[0_0_1rem_rgba(16,185,129,0.25)]',
  delayed: 'border-rose-400/40 bg-rose-500/15 text-rose-300',
  early: 'border-sky-400/40 bg-sky-500/15 text-sky-300',
  none: 'border-white/15 bg-white/5 text-white/60',
};
const arrivalChipCls: Record<ArrivalKey, string> = {
  ontime: 'bg-emerald-50 text-emerald-700',
  delayed: 'bg-rose-50 text-rose-700',
  early: 'bg-sky-50 text-sky-700',
  none: 'bg-slate-100 text-slate-500',
};

const PlaneGlyph = ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
  <svg viewBox="0 0 24 24" className={className} style={style} fill="currentColor" aria-hidden="true">
    <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" />
  </svg>
);

function HeroStyles() {
  return (
    <style>{`
      @keyframes ft-flow { to { stroke-dashoffset: -200; } }
      @keyframes ft-pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.35;transform:scale(.7)} }
      @keyframes ft-float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
      @keyframes ft-cloud { 0%{transform:translateX(130%);opacity:0} 18%{opacity:.5} 82%{opacity:.5} 100%{transform:translateX(-130%);opacity:0} }
      .ft-flow{stroke-dasharray:10 14;animation:ft-flow 2.4s linear infinite}
      .ft-pulse{animation:ft-pulse 1.2s cubic-bezier(0,0,.25,1) infinite}
      .ft-float{animation:ft-float 5s ease-in-out infinite}
      .ft-cloud{animation:ft-cloud 16s linear infinite}
      @media (prefers-reduced-motion: reduce){ .ft-flow,.ft-pulse,.ft-float,.ft-cloud{animation:none} }
    `}</style>
  );
}

function AirportBox({ side, iata, icao }: { side: 'from' | 'to'; iata: string | null; icao: string | null }) {
  return (
    <div className="flex flex-1 flex-col items-center rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-center">
      <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-white/40">
        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor">
          {side === 'from' ? (
            <path d="M2.5 19h19v2h-19zM22 9.7c-.2-.8-1-1.3-1.8-1.1L14.6 10 7.1 3l-1.9.5 4.5 7.8-4.7 1.3-1.9-1.4-1.4.4 2.5 4.3 16.1-4.3c.8-.3 1.3-1.1 1-1.9z" />
          ) : (
            <path d="M2.5 19h19v2h-19zM22.1 13.6c.3-.8-.2-1.6-1-1.8l-5.6-1.5L11.8 2 9.9 2.5l2 8.2-4.8-1.3-1-2.5-1.4-.4-.3 4.9 16 4.3c.8.2 1.6-.3 1.9-1z" />
          )}
        </svg>
        {side}
      </div>
      <div className="mt-1 font-mono text-2xl font-semibold tracking-wider text-white">{iata ?? '—'}</div>
      <div className="text-[10px] font-semibold text-white/30">{icao ?? ''}</div>
    </div>
  );
}

function StatPill({ label, value, unit, accent }: { label: string; value: string; unit: string; accent?: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center rounded-2xl border border-white/10 bg-white/[0.04] px-2 py-2.5">
      <span className="text-[9px] font-bold uppercase tracking-widest text-white/40">{label}</span>
      <span className="mt-1 font-mono text-base font-semibold tabular-nums text-white">
        {value}
        <span className={`ml-1 text-[9px] font-bold ${accent ? 'text-emerald-300' : 'text-white/40'}`}>{unit}</span>
      </span>
    </div>
  );
}

const BoardingCard = ({ flight, status }: { flight: FlightRecord | null; status: Arrival }) => {
  if (!flight) {
    return (
      <div className="relative flex min-h-[30rem] w-full max-w-sm flex-col items-center justify-center overflow-hidden rounded-[2rem] border border-white/10 p-8 text-center" style={{ background: 'radial-gradient(120% 100% at 50% 0%, #0a3a73 0%, #062349 45%, #04142e 100%)' }}>
        <PlaneGlyph className="h-12 w-12 text-white/20" />
        <p className="mt-4 text-sm font-semibold text-white/70">No flight selected</p>
        <p className="mt-1 text-xs text-white/40">Pick a flight from the list to see its route and live telemetry.</p>
      </div>
    );
  }

  const airborne = !isOnGround(flight);
  const flightNo = flight.flight || flight.callsign || flight.hex?.toUpperCase() || '—';
  const eta = etaInfo(flight.eta);

  return (
    <div className="relative w-full max-w-sm overflow-hidden rounded-[2rem] border border-white/10 p-6 text-white shadow-[0_1.5rem_3rem_rgba(3,69,143,0.25)]" style={{ background: 'radial-gradient(120% 100% at 50% 0%, #0a3a73 0%, #062349 45%, #04142e 100%)' }}>
      <div className="pointer-events-none absolute left-[10%] top-0 h-px w-4/5 bg-gradient-to-r from-transparent via-white/40 to-transparent" />
      <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-[40%] bg-[#f9b232]/20 blur-3xl" />

      {/* header */}
      <div className="flex items-start justify-between">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#03458f] shadow-lg shadow-[#03458f]/40">
          <PlaneGlyph className="h-5 w-5 text-white" style={{ transform: 'rotate(45deg)' }} />
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${arrivalBadgeCls[status.key]}`}>
            {status.key === 'ontime' ? (
              <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
            ) : status.key === 'none' ? (
              <span className="h-1.5 w-1.5 rounded-full bg-white/40" />
            ) : (
              <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
            )}
            {status.label}
          </span>
          <div className="flex items-center gap-2">
            {flight.airline && <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white/70">{flight.airline}</span>}
            <span className="font-mono text-sm font-semibold tracking-wide text-white/90">{flightNo}</span>
          </div>
          <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-white/40">
            <span className={`h-1.5 w-1.5 rounded-full ${airborne ? 'bg-emerald-400 ft-pulse' : 'bg-white/30'}`} />
            {motionLabel(flight)}
          </span>
        </div>
      </div>

      {/* route */}
      <div className="mt-6 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <AirportBox side="from" iata={flight.origIata} icao={flight.origIcao} />
        <div className="flex flex-col items-center px-1">
          <svg width="86" viewBox="-30 -10 660 200" fill="none" className="overflow-visible">
            <path d="M4 143C100.5 38.3 356.3 -108.2 607.5 143" stroke="rgba(255,255,255,0.18)" strokeWidth="10" strokeLinecap="round" strokeDasharray="22 22" />
            <path className="ft-flow" d="M4 143C101 38.5 321.5 -78.5 543 87" stroke="#10b981" strokeWidth="18" strokeLinecap="round" />
          </svg>
          <div className="-mt-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 ft-pulse" />
            {eta.mins !== null && eta.mins > 0 && eta.mins < 1440 ? `ETA ${eta.mins} MIN` : `HDG ${trackDeg(flight.track)}`}
          </div>
        </div>
        <AirportBox side="to" iata={flight.destIata} icao={flight.destIcao} />
      </div>

      {/* stat pills */}
      <div className="mt-4 flex gap-2">
        <StatPill label="Speed" value={numFmt(flight.gspeedKt)} unit="KT" accent />
        <StatPill label="Altitude" value={numFmt(flight.altFt)} unit="FT" />
        <StatPill label="Vertical" value={vRate(flight.vspeedFpm)} unit="FPM" />
      </div>

      {/* plane visual */}
      <div className="relative my-5 flex h-28 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.03] to-transparent">
        <div className="ft-cloud pointer-events-none absolute top-4 left-0 h-6 w-16 rounded-full bg-white/10 blur-md" />
        <div className="ft-cloud pointer-events-none absolute bottom-4 left-0 h-5 w-12 rounded-full bg-white/10 blur-md" style={{ animationDelay: '7s' }} />
        <div className="ft-float">
          <PlaneGlyph
            className="h-16 w-16 text-white drop-shadow-[0_0_1.2rem_rgba(255,255,255,0.35)]"
            style={{ transform: `rotate(${flight.track ?? 0}deg)` }}
          />
        </div>
        <div className="absolute bottom-2 left-0 right-0 text-center">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-white/45">{aircraftName(flight.type)}</span>
        </div>
      </div>

      {/* footer items */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-2.5 text-center">
          <div className="text-[9px] font-bold uppercase tracking-wide text-white/40">Reg</div>
          <div className="mt-0.5 font-mono text-xs font-semibold text-white">{flight.reg ?? '—'}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-2.5 text-center">
          <div className="text-[9px] font-bold uppercase tracking-wide text-white/40">Heading</div>
          <div className="mt-0.5 font-mono text-xs font-semibold text-white">{trackDeg(flight.track)}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-2.5 text-center">
          <div className="text-[9px] font-bold uppercase tracking-wide text-white/40">ETA</div>
          <div className="mt-0.5 font-mono text-xs font-semibold text-white">{eta.time}</div>
        </div>
      </div>

      {/* features */}
      <div className="mt-4 flex items-center justify-between px-1 text-[10px] font-bold uppercase tracking-wide text-white/40">
        <span className="flex items-center gap-1.5 text-emerald-300 drop-shadow-[0_0_0.6rem_rgba(16,185,129,0.5)]">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12.55a11 11 0 0 1 14 0M8.5 16.1a6 6 0 0 1 7 0M12 20h.01M2 8.82a15 15 0 0 1 20 0" />
          </svg>
          Live tracking
        </span>
        <span className={`flex items-center gap-1.5 ${airborne ? 'text-[#f9b232] drop-shadow-[0_0_0.6rem_rgba(249,178,50,0.5)]' : ''}`}>
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor"><path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM6 19h12v2H6z" /></svg>
          {airborne ? 'Fasten seatbelt' : 'Parked'}
        </span>
      </div>
    </div>
  );
};

export default function FlightTrackerPage() {
  const [bounds, setBounds] = useState<Bounds>(DEFAULT_BOUNDS);
  const [flights, setFlights] = useState<FlightRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const [searchField, setSearchField] = useState<SearchField>('flight');
  const [searchValue, setSearchValue] = useState('');
  const [activeSearch, setActiveSearch] = useState<{ field: SearchField; value: string } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // First ETA we saw for each flight this session — used to detect delay / early drift.
  const etaBaselineRef = useRef<Map<string, number>>(new Map());

  const arrivalStatus = useCallback((f: FlightRecord): Arrival => {
    const cur = f.eta ? Date.parse(f.eta) : NaN;
    if (Number.isNaN(cur)) return { key: 'none', label: isOnGround(f) ? 'On ground' : 'En route' };
    const base = etaBaselineRef.current.get(f.id);
    const delta = base ? Math.round((cur - base) / 60000) : 0;
    if (delta >= 6) return { key: 'delayed', label: `Delayed ${delta}m` };
    if (delta <= -6) return { key: 'early', label: `Early ${Math.abs(delta)}m` };
    return { key: 'ontime', label: 'On time' };
  }, []);

  // Keep latest bounds without making the fetch re-run on every keystroke.
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;

  const submitSearch = () => {
    const v = searchValue.trim();
    setSelectedId(null);
    setActiveSearch(v ? { field: searchField, value: v } : null);
  };
  const clearSearch = () => {
    setSearchValue('');
    setActiveSearch(null);
    setSelectedId(null);
  };

  const loadFlights = useCallback(async () => {
    const b = boundsRef.current;
    const queryString =
      activeSearch && activeSearch.value.trim()
        ? `${SEARCH_PARAM[activeSearch.field]}=${encodeURIComponent(activeSearch.value.trim())}`
        : `lamin=${b.lamin}&lomin=${b.lomin}&lamax=${b.lamax}&lomax=${b.lomax}`;
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/flight-radar?${queryString}`, { credentials: 'include' });
      const data = (await response.json().catch(() => null)) as { flights?: FlightRecord[]; error?: string } | null;
      if (!response.ok) throw new Error(data?.error || 'Unable to load flight data');
      const next = data?.flights ?? [];
      // Record the first ETA seen per flight so we can detect later drift.
      for (const f of next) {
        if (f.eta && !etaBaselineRef.current.has(f.id)) {
          const t = Date.parse(f.eta);
          if (!Number.isNaN(t)) etaBaselineRef.current.set(f.id, t);
        }
      }
      setFlights(next);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load flight data.');
    } finally {
      setLoading(false);
    }
  }, [activeSearch]);

  const featuredFlight = useMemo(
    () => flights.find((f) => f.id === selectedId) ?? flights[0] ?? null,
    [flights, selectedId],
  );

  useEffect(() => {
    void loadFlights();
  }, [loadFlights]);

  // Light auto-refresh (only while the tab is visible) so ETA drift / status stays current.
  useEffect(() => {
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      void loadFlights();
    }, 60000);
    return () => clearInterval(id);
  }, [loadFlights]);

  const inputClass =
    'mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 placeholder-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500';

  return (
    <div className="min-h-screen bg-white px-6 py-10 text-slate-900">
      <HeroStyles />
      <div className="mx-auto max-w-6xl space-y-8">
        <header className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-600">Flight tracker</span>
          <h1 className="text-3xl font-semibold">Live air traffic</h1>
          <p className="max-w-2xl text-sm text-slate-500">
            Real-time flights from FlightRadar24 — routes, aircraft, and live telemetry. Tap a flight to view its boarding card.
          </p>
        </header>

        <section className="grid gap-8 lg:grid-cols-[auto_1fr] lg:items-start">
          <div className="flex justify-center lg:justify-start">
            <BoardingCard flight={featuredFlight} status={featuredFlight ? arrivalStatus(featuredFlight) : { key: 'none', label: '—' }} />
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold">Find a flight</h2>
                  <p className="text-xs text-slate-400">Search worldwide — no map area needed</p>
                </div>
                <button
                  type="button"
                  onClick={loadFlights}
                  disabled={loading}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                  title="Refresh"
                >
                  <svg viewBox="0 0 24 24" className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
                  </svg>
                </button>
              </div>

              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <select
                  value={searchField}
                  onChange={(e) => setSearchField(e.target.value as SearchField)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 sm:w-40"
                >
                  {(Object.keys(SEARCH_META) as SearchField[]).map((f) => (
                    <option key={f} value={f}>{SEARCH_META[f].label}</option>
                  ))}
                </select>
                <input
                  value={searchValue}
                  onChange={(e) => setSearchValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      submitSearch();
                    }
                  }}
                  placeholder={SEARCH_META[searchField].placeholder}
                  className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 placeholder-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
                <button
                  type="button"
                  onClick={submitSearch}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#03458f] px-4 py-2 text-sm font-semibold text-white hover:bg-[#03397a]"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                  Search
                </button>
              </div>

              {activeSearch && (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700">
                    {SEARCH_META[activeSearch.field].label}: {activeSearch.value.toUpperCase()}
                    <button onClick={clearSearch} className="text-emerald-700/70 hover:text-emerald-900" aria-label="Clear search">✕</button>
                  </span>
                  <span className="text-slate-400">Showing global results</span>
                </div>
              )}

              <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
                <p>Results: <span className="font-semibold text-slate-700">{flights.length}</span></p>
                <p>Last updated: {lastUpdated || '—'}</p>
              </div>
              {error && (
                <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>
              )}

              <details className="mt-4 border-t border-slate-100 pt-3">
                <summary className="cursor-pointer select-none text-xs font-semibold text-slate-500 hover:text-slate-700">Or browse a map area</summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {(
                    [
                      { key: 'lamin', label: 'Lat min' },
                      { key: 'lomin', label: 'Lon min' },
                      { key: 'lamax', label: 'Lat max' },
                      { key: 'lomax', label: 'Lon max' },
                    ] as const
                  ).map((field) => (
                    <label key={field.key} className="text-xs font-semibold text-slate-600">
                      {field.label}
                      <input value={bounds[field.key]} onChange={(e) => setBounds((c) => ({ ...c, [field.key]: e.target.value }))} className={inputClass} />
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSearchValue('');
                    setActiveSearch(null);
                    setSelectedId(null);
                    void loadFlights();
                  }}
                  className="mt-3 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Browse this area
                </button>
                <p className="mt-2 text-[11px] text-slate-400">FlightRadar24 caps the area size — searching by flight, airline, airport or registration above works worldwide.</p>
              </details>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="max-h-[26rem] space-y-1.5 overflow-y-auto pr-1">
                {loading ? (
                  <p className="px-3 py-6 text-center text-sm text-slate-400">Loading flights…</p>
                ) : flights.length === 0 ? (
                  <p className="px-3 py-6 text-center text-sm text-slate-400">{activeSearch ? 'No live flights match that search right now.' : 'No flights in this area.'}</p>
                ) : (
                  flights.slice(0, 60).map((flight) => {
                    const selected = featuredFlight?.id === flight.id;
                    const ground = isOnGround(flight);
                    const route = `${flight.origIata ?? '—'} → ${flight.destIata ?? '—'}`;
                    const st = arrivalStatus(flight);
                    return (
                      <button
                        key={flight.id}
                        onClick={() => setSelectedId(flight.id)}
                        className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                          selected ? 'border-emerald-300 bg-emerald-50' : 'border-transparent bg-slate-50/60 hover:bg-slate-100'
                        }`}
                      >
                        <PlaneGlyph className={`h-4 w-4 shrink-0 ${ground ? 'text-slate-300' : 'text-emerald-500'}`} style={{ transform: `rotate(${flight.track ?? 0}deg)` }} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-semibold text-slate-900">{flight.flight || flight.callsign || flight.hex?.toUpperCase()}</span>
                            {flight.airline && <span className="rounded bg-slate-100 px-1 font-mono text-[9px] font-bold text-slate-500">{flight.airline}</span>}
                          </div>
                          <p className="truncate font-mono text-[11px] text-slate-400">{route}</p>
                        </div>
                        <div className="hidden shrink-0 flex-col items-end gap-0.5 sm:flex">
                          <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${arrivalChipCls[st.key]}`}>{st.label}</span>
                          <div className="font-mono text-xs font-semibold text-slate-900">{numFmt(flight.altFt)} ft</div>
                          <div className="font-mono text-[11px] text-slate-400">{numFmt(flight.gspeedKt)} kt · {flight.type ?? '—'}</div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
