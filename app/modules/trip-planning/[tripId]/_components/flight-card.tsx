'use client';

import { APP_LOCALE } from '@/lib/locale';
import { useEffect, useState, useSyncExternalStore } from 'react';

import {
  flightCountdown,
  flightPunctuality,
  normalizeFlightNumber,
  type Punctuality,
} from '@/lib/flight-status';

import type { TripItineraryItemSummary } from '../../types';

interface LiveFlight {
  flight: string | null;
  callsign: string | null;
  altFt: number | null;
  gspeedKt: number | null;
  origIata: string | null;
  destIata: string | null;
  eta: string | null;
}

/** How often the card refreshes live position while it is on screen. */
const POLL_MS = 90_000;
/** How often the countdown re-reads the clock. */
const TICK_MS = 30_000;

let tickNow = Date.now();
const tickListeners = new Set<() => void>();
let tickTimer: ReturnType<typeof setInterval> | null = null;

function subscribeToClock(onChange: () => void) {
  tickListeners.add(onChange);
  if (tickTimer === null) {
    tickTimer = setInterval(() => {
      tickNow = Date.now();
      tickListeners.forEach((listener) => listener());
    }, TICK_MS);
  }
  return () => {
    tickListeners.delete(onChange);
    if (tickListeners.size === 0 && tickTimer !== null) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  };
}

/**
 * The current time, or null on the server so the first client render matches
 * the markup React hydrated. Cached between ticks — `getSnapshot` must be
 * stable or React re-renders forever.
 */
function useNow(): number | null {
  return useSyncExternalStore(
    subscribeToClock,
    () => tickNow,
    () => null,
  );
}

const PUNCTUALITY_STYLE: Record<Punctuality, { chip: string; dot: string }> = {
  early: { chip: 'bg-sky-50 text-sky-700 ring-sky-200', dot: 'bg-sky-500' },
  ontime: { chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500' },
  late: { chip: 'bg-rose-50 text-rose-700 ring-rose-200', dot: 'bg-rose-500' },
  unknown: { chip: 'bg-slate-50 text-slate-500 ring-slate-200', dot: 'bg-slate-400' },
};

function clockTime(value: string | null): string {
  if (!value) return '--:--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--';
  return date.toLocaleTimeString(APP_LOCALE, { hour: '2-digit', minute: '2-digit', hour12: false });
}

/**
 * Live status for one flight, from the same FlightRadar24 proxy the
 * flight-tracker module uses. Only polls while there is a flight number to
 * search on and the flight is near enough in time to be worth the call — the
 * upstream API is paid and rate-limited to 60/min per user.
 */
function useLiveFlight(flightNumber: string | null, active: boolean) {
  // One object, tagged with the flight it belongs to, so a stale result from a
  // previous flight number can never be shown against a new one. `null` means
  // "not answered yet"; `live: null` means "answered, no match".
  const [result, setResult] = useState<{ forFlight: string; live: LiveFlight | null } | null>(null);

  useEffect(() => {
    if (!flightNumber || !active) return;
    let cancelled = false;
    const controller = new AbortController();

    const load = async () => {
      try {
        const r = await fetch(`/api/flight-radar?flights=${encodeURIComponent(flightNumber)}`, {
          credentials: 'include',
          signal: controller.signal,
        });
        if (!r.ok) throw new Error('lookup failed');
        const data = (await r.json()) as { flights?: LiveFlight[] };
        if (cancelled) return;
        setResult({ forFlight: flightNumber, live: data.flights?.[0] ?? null });
      } catch {
        if (!cancelled) setResult({ forFlight: flightNumber, live: null });
      }
    };

    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [flightNumber, active]);

  const answered = result !== null && result.forFlight === flightNumber;
  const live = answered ? result.live : null;

  // Derived rather than stored, so nothing has to be set synchronously.
  const state: 'idle' | 'loading' | 'ok' | 'unavailable' =
    !flightNumber || !active ? 'idle' : !answered ? 'loading' : live ? 'ok' : 'unavailable';

  return { live, state };
}

export default function FlightCard({
  item,
  canEdit,
  isPending,
  onEdit,
  onDelete,
  onToggleComplete,
}: {
  item: TripItineraryItemSummary;
  canEdit: boolean;
  isPending: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onToggleComplete: () => void;
}) {
  const details = item.details ?? {};
  const flightNumber = normalizeFlightNumber(details.flightNumber);

  const now = useNow();
  const countdown = now !== null ? flightCountdown(now, item.scheduledAt, item.endsAt) : null;
  // Don't spend a paid lookup on a flight that has already landed.
  const worthTracking = countdown !== null && countdown.phase !== 'landed' && countdown.phase !== 'unknown';
  const { live, state } = useLiveFlight(flightNumber, worthTracking);

  const punctuality = flightPunctuality(item.endsAt, live?.eta ?? null);
  const style = PUNCTUALITY_STYLE[punctuality.status];
  const done = item.completedAt !== null;

  const from = details.departAirport || live?.origIata || '';
  const to = details.arriveAirport || live?.destIata || '';

  return (
    <div
      className={`group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md ${
        done ? 'opacity-60' : ''
      }`}
    >
      {/* Airline strip */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-sky-50 to-white px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-500 text-white">
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 00-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1L15 22v-1.5L13 19v-5.5L21 16z" />
            </svg>
          </span>
          <p className="truncate text-xs font-bold uppercase tracking-wider text-sky-900">
            {item.providerName || 'Flight'}
          </p>
          {details.flightNumber && (
            <span className="shrink-0 rounded-md bg-white px-2 py-0.5 font-mono text-xs font-bold text-sky-700 ring-1 ring-sky-200">
              {details.flightNumber}
            </span>
          )}
        </div>
        <span
          className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${style.chip}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
          {punctuality.status === 'unknown' && state === 'loading' ? 'Checking…' : punctuality.label}
        </span>
      </div>

      {/* Route */}
      <div className="px-4 py-4">
        <div className="flex items-end gap-3">
          <div className="text-left">
            <p className="font-mono text-2xl font-bold leading-none tracking-tight text-slate-900">
              {from || '—'}
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-700">{clockTime(item.scheduledAt)}</p>
          </div>

          <div className="relative mb-1.5 flex-1">
            <div className="h-px w-full bg-gradient-to-r from-slate-200 via-sky-300 to-slate-200" />
            <svg
              className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 text-sky-500"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 00-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1L15 22v-1.5L13 19v-5.5L21 16z" />
            </svg>
          </div>

          <div className="text-right">
            <p className="font-mono text-2xl font-bold leading-none tracking-tight text-slate-900">
              {to || '—'}
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-700">{clockTime(item.endsAt)}</p>
          </div>
        </div>

        <p className={`mt-3 text-sm font-semibold ${countdown?.imminent ? 'text-sky-700' : 'text-slate-500'}`}>
          {countdown?.label ?? '—'}
        </p>

        {item.description && (
          <p className={`mt-1 text-sm ${done ? 'text-slate-400 line-through' : 'text-slate-600'}`}>
            {item.description}
          </p>
        )}

        {/* Boarding-pass style detail strip */}
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 border-t border-dashed border-slate-200 pt-3">
          {[
            ['Terminal', details.terminal],
            ['Gate', details.gate],
            ['Seat', details.seat],
            ['Cabin', details.cabin],
            ['Baggage', details.baggage],
            ['Conf', item.confirmationCode],
          ]
            .filter(([, value]) => Boolean(value))
            .map(([label, value]) => (
              <div key={label as string}>
                <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">{label}</p>
                <p className="font-mono text-sm font-semibold text-slate-800">{value}</p>
              </div>
            ))}
        </div>

        {live && (
          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
            <span className="flex items-center gap-1 font-medium text-emerald-600">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              Live
            </span>
            {live.altFt != null && <span>{live.altFt.toLocaleString(APP_LOCALE)} ft</span>}
            {live.gspeedKt != null && <span>{live.gspeedKt} kt</span>}
            {live.eta && <span>ETA {clockTime(live.eta)}</span>}
          </p>
        )}
        {!live && state === 'unavailable' && flightNumber && (
          <p className="mt-3 text-[11px] text-slate-400">
            {item.endsAt ? 'No live track for this flight right now.' : 'Add an arrival time to track punctuality.'}
          </p>
        )}
        {!flightNumber && (
          <p className="mt-3 text-[11px] text-slate-400">Add a flight number to track this live.</p>
        )}
      </div>

      {canEdit && (
        <div className="flex items-center gap-3 border-t border-slate-100 bg-slate-50/60 px-4 py-2">
          <button
            type="button"
            onClick={onToggleComplete}
            disabled={isPending}
            className="text-xs font-medium text-slate-500 transition-colors hover:text-primary disabled:opacity-50"
          >
            {done ? 'Mark incomplete' : 'Mark complete'}
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="text-xs font-medium text-slate-500 transition-colors hover:text-primary"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={isPending}
            className="ml-auto text-xs font-medium text-slate-400 transition-colors hover:text-rose-600 disabled:opacity-50"
          >
            Remove
          </button>
        </div>
      )}
    </div>
  );
}
