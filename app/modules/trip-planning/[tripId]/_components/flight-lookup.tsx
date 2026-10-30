'use client';

import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';

import { SILENT_BANNER_HEADER } from '@/app/ui/banner';
import type { FlightCandidate, FlightLookup, LookupAirport } from '@/lib/flight-status';
import { APP_LOCALE } from '@/lib/locale';

const SEARCH_DEBOUNCE_MS = 200;
const SEARCH_MIN_CHARS = 2;

const labelClass = 'text-xs font-medium text-gray-500';
const fieldClass = 'mt-1 w-full rounded-lg bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30';

/** "Thu 30 Oct" */
export const seenOn = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(APP_LOCALE, { weekday: 'short', day: 'numeric', month: 'short' }) : null;

/** "NBO → LHR · 09:30–15:30 · 9h" */
export function describeCandidate(c: FlightCandidate): string {
  const route = `${c.origin?.iata ?? '?'} → ${c.destination?.iata ?? '?'}`;
  const times = c.departureTime || c.arrivalTime ? `${c.departureTime ?? '—'}–${c.arrivalTime ?? '—'}` : null;
  const duration =
    c.durationMinutes != null ? `${Math.floor(c.durationMinutes / 60)}h${c.durationMinutes % 60 ? ` ${c.durationMinutes % 60}m` : ''}` : null;
  return [route, times, duration].filter(Boolean).join(' · ');
}

// ---------------------------------------------------------------- flight or tail number

type LookupState =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'choose'; candidates: FlightCandidate[] }
  | { state: 'none'; query: string }
  | { state: 'error'; message: string };

/**
 * The flight number field, with a look-up that fills the rest of the form from
 * what FlightRadar24 has flown lately under that number, callsign or tail
 * number. One match fills straight away; several are offered to pick from.
 */
export function FlightNumberLookup({
  value,
  onChange,
  onPick,
}: {
  value: string;
  onChange: (value: string) => void;
  onPick: (candidate: FlightCandidate) => void;
}) {
  const [lookup, setLookup] = useState<LookupState>({ state: 'idle' });
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  const ready = value.trim().length >= 3;

  const pick = (candidate: FlightCandidate) => {
    setLookup({ state: 'idle' });
    onPick(candidate);
  };

  const find = async () => {
    if (!ready || lookup.state === 'loading') return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLookup({ state: 'loading' });
    try {
      const response = await fetch(`/api/flight-radar/lookup?q=${encodeURIComponent(value.trim())}`, {
        credentials: 'include',
        signal: controller.signal,
        // The form shows the outcome itself.
        headers: { [SILENT_BANNER_HEADER]: '1' },
      });
      const body = (await response.json().catch(() => null)) as { lookup?: FlightLookup; error?: string } | null;
      if (!response.ok || !body?.lookup) throw new Error(body?.error ?? 'FlightRadar24 could not be reached.');
      const { candidates, query } = body.lookup;
      if (candidates.length === 0) setLookup({ state: 'none', query: query.value });
      else if (candidates.length === 1) pick(candidates[0]!);
      else setLookup({ state: 'choose', candidates });
    } catch (error) {
      if (controller.signal.aborted) return;
      setLookup({ state: 'error', message: error instanceof Error ? error.message : 'FlightRadar24 could not be reached.' });
    }
  };

  return (
    <div>
      <label className="block">
        <span className={labelClass}>Flight or tail number</span>
        <div className="mt-1 flex gap-1.5">
          <input
            type="text"
            placeholder="KQ 100 or 5Y-KZX"
            value={value}
            onChange={(e) => {
              onChange(e.target.value.toUpperCase());
              if (lookup.state !== 'idle' && lookup.state !== 'loading') setLookup({ state: 'idle' });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void find();
              }
            }}
            className={`${fieldClass} !mt-0 font-mono uppercase`}
          />
          <button
            type="button"
            onClick={() => void find()}
            disabled={!ready || lookup.state === 'loading'}
            title="Fill the airline, airports, time and duration from FlightRadar24"
            className="shrink-0 rounded-lg bg-sky-600 px-3 text-xs font-semibold text-white transition hover:bg-sky-700 disabled:opacity-50"
          >
            {lookup.state === 'loading' ? 'Looking…' : 'Look up'}
          </button>
        </div>
      </label>

      {lookup.state === 'choose' && (
        <ul className="mt-2 divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white" aria-label="Flights found">
          {lookup.candidates.map((c) => (
            <li key={`${c.flightNumber}-${c.origin?.iata}-${c.destination?.iata}`}>
              <button type="button" onClick={() => pick(c)} className="flex w-full items-center gap-3 px-3 py-2 text-left transition hover:bg-sky-50">
                <span className="w-16 shrink-0 font-mono text-sm font-semibold text-gray-900">{c.flightNumber}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-gray-700">
                  {describeCandidate(c)}
                  {c.airline && <span className="text-gray-400"> · {c.airline.name}</span>}
                </span>
                {c.airborne ? (
                  <span className="shrink-0 rounded-md bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-700">In the air</span>
                ) : (
                  <span className="shrink-0 text-[11px] text-gray-400">{seenOn(c.lastSeen)}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {lookup.state === 'none' && (
        <p className="mt-1.5 text-xs text-amber-700">FlightRadar24 hasn’t seen {lookup.query} fly in the last ten days. Fill the flight in by hand.</p>
      )}
      {lookup.state === 'error' && <p className="mt-1.5 text-xs text-rose-600">{lookup.message}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- airports

/**
 * An airport code field that completes from the airport table as you type a
 * code, a city or a name. Picking one sets the IATA code; typing a code
 * straight in works as before.
 */
export function AirportInput({
  value,
  onChange,
  onPick,
  placeholder,
  className = '',
}: {
  value: string;
  onChange: (value: string) => void;
  onPick: (airport: LookupAirport) => void;
  placeholder?: string;
  className?: string;
}) {
  const [options, setOptions] = useState<LookupAirport[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const request = useRef<AbortController | null>(null);
  const listId = useId();

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      request.current?.abort();
    },
    [],
  );

  const search = (query: string) => {
    if (timer.current) clearTimeout(timer.current);
    request.current?.abort();
    if (query.trim().length < SEARCH_MIN_CHARS) {
      setOptions([]);
      setOpen(false);
      return;
    }
    timer.current = setTimeout(async () => {
      const controller = new AbortController();
      request.current = controller;
      try {
        const response = await fetch(`/api/airports?q=${encodeURIComponent(query.trim())}`, {
          credentials: 'include',
          signal: controller.signal,
          headers: { [SILENT_BANNER_HEADER]: '1' },
        });
        if (!response.ok) return;
        const { airports } = (await response.json()) as { airports: LookupAirport[] };
        if (controller.signal.aborted) return;
        setOptions(airports);
        setActive(0);
        setOpen(airports.length > 0);
      } catch {
        // A lost search just leaves the list as it was.
      }
    }, SEARCH_DEBOUNCE_MS);
  };

  const pick = (airport: LookupAirport) => {
    onPick(airport);
    setOptions([]);
    setOpen(false);
  };

  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open || options.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % options.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + options.length) % options.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(options[active]!);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value.toUpperCase());
          search(e.target.value);
        }}
        onFocus={() => options.length > 0 && setOpen(true)}
        // After the click on an option has landed.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={keys}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        className={`${fieldClass} font-mono uppercase ${className}`}
      />
      {open && options.length > 0 && (
        <ul id={listId} role="listbox" className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 min-w-64 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
          {options.map((airport, i) => (
            <li key={airport.iata} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(airport)}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left ${i === active ? 'bg-sky-50' : ''}`}
              >
                <span className="w-10 shrink-0 font-mono text-sm font-semibold text-gray-900">{airport.iata}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-gray-800">{airport.city}</span>
                  <span className="block truncate text-[11px] text-gray-400">
                    {airport.name} · {airport.country}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
