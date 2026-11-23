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

/** "Wed 25 Nov" for a "YYYY-MM-DD". */
export function dayName(key: string | null | undefined): string {
  if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return '';
  return new Date(`${key}T12:00:00Z`).toLocaleDateString(APP_LOCALE, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function shiftDay(key: string, days: number): string {
  return new Date(Date.parse(`${key}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function hoursAndMinutes(minutes: number | null): string | null {
  if (minutes == null) return null;
  return `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ''}`;
}

/** "ADD → FCO · 23:20 → 03:55 (+1) · 6h 35m" */
export function describeCandidate(c: FlightCandidate): string {
  const route = `${c.origin?.iata ?? '?'} → ${c.destination?.iata ?? '?'}`;
  // "~" marks a departure worked back from the landing (see departureEstimated).
  const departs = c.departureTime ? `${c.departureEstimated ? '~' : ''}${c.departureTime}` : '—';
  const nextDay =
    c.departDate && c.arriveDate && c.arriveDate !== c.departDate ? (c.arriveDate > c.departDate ? ' (+1)' : ' (−1)') : '';
  const times = c.departureTime || c.arrivalTime ? `${departs} → ${c.arrivalTime ?? '—'}${nextDay}` : null;
  return [route, times, hoursAndMinutes(c.durationMinutes)].filter(Boolean).join(' · ');
}

const WEEKDAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

/** The badge on a result: what the flight does on the date looked up. */
function dayBadge(c: FlightCandidate, date: string): { text: string; tone: string } {
  if (c.airborne) return { text: 'In the air now', tone: 'bg-sky-100 text-sky-700' };
  const weekday = WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
  switch (c.dayStatus) {
    case 'flown':
      return { text: 'Flew this day', tone: 'bg-emerald-50 text-emerald-700' };
    case 'expected':
      return { text: `Expected${c.frequency ? ` · ${c.frequency}` : ''}`, tone: 'bg-sky-50 text-sky-700' };
    case 'not-usual':
      return { text: `Not flown on ${weekday} lately${c.frequency ? ` · flies ${c.frequency}` : ''}`, tone: 'bg-amber-50 text-amber-800' };
    case 'no-record':
      return { text: 'No record of it flying this day', tone: 'bg-rose-50 text-rose-700' };
    default:
      return { text: c.frequency ?? '', tone: 'text-gray-400' };
  }
}

// ---------------------------------------------------------------- flight or tail number

type LookupState =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'choose'; candidates: FlightCandidate[]; date: string }
  | { state: 'none'; query: string; date: string }
  | { state: 'error'; message: string };

/**
 * A flight number often flies several legs (ET552 is Addis → Rome → Toronto).
 * The leg that leaves from (or, for an arrival, lands at) the event's airport
 * comes first.
 */
export function rankCandidates(candidates: FlightCandidate[], airport: string | null | undefined, arrival: boolean): FlightCandidate[] {
  const code = airport?.trim().toUpperCase();
  if (!code) return candidates;
  const matches = (c: FlightCandidate) => {
    const end = arrival ? c.destination : c.origin;
    return end?.iata === code || end?.icao === code;
  };
  return [...candidates.filter(matches), ...candidates.filter((c) => !matches(c))];
}

/**
 * The flight number field and its look-up, for a flight on a date the planner
 * gives: the departure date (or, for an arrival, the landing date). It starts
 * on the itinerary day's date and can be moved, and nothing is looked up
 * without one. Every leg found is listed with the dates it leaves and lands
 * and whether it flew, is expected, or doesn't usually fly that day; picking
 * one fills the form.
 */
export function FlightNumberLookup({
  value,
  date,
  airport,
  arrival = false,
  onChange,
  onPick,
}: {
  value: string;
  /** The itinerary day's "YYYY-MM-DD", where the look-up's date starts. */
  date: string | null;
  /** The airport the event is at, when already filled: its leg is offered first. */
  airport?: string | null;
  arrival?: boolean;
  onChange: (value: string) => void;
  /** The leg picked, and the date it was looked up for. */
  onPick: (candidate: FlightCandidate, date: string) => void;
}) {
  const [lookup, setLookup] = useState<LookupState>({ state: 'idle' });
  // Follows the itinerary day until the planner picks another date here.
  const [chosenDate, setChosenDate] = useState<string | null>(null);
  const lookupDate = chosenDate ?? date ?? '';
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  const hasNumber = value.trim().length >= 3;
  const hasDate = /^\d{4}-\d{2}-\d{2}$/.test(lookupDate);
  const endWord = arrival ? 'arrival' : 'departure';

  const pick = (candidate: FlightCandidate, on: string) => {
    setLookup({ state: 'idle' });
    onPick(candidate, on);
  };

  const find = async (on: string = lookupDate) => {
    if (!hasNumber || !/^\d{4}-\d{2}-\d{2}$/.test(on)) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLookup({ state: 'loading' });
    try {
      const params = new URLSearchParams({ q: value.trim(), date: on, end: endWord });
      const response = await fetch(`/api/flight-radar/lookup?${params}`, {
        credentials: 'include',
        signal: controller.signal,
        // The form shows the outcome itself.
        headers: { [SILENT_BANNER_HEADER]: '1' },
      });
      const body = (await response.json().catch(() => null)) as { lookup?: FlightLookup; error?: string } | null;
      if (!response.ok || !body?.lookup) throw new Error(body?.error ?? 'FlightRadar24 could not be reached.');
      const { query } = body.lookup;
      const candidates = rankCandidates(body.lookup.candidates, airport, arrival);
      setLookup(candidates.length === 0 ? { state: 'none', query: query.value, date: on } : { state: 'choose', candidates, date: on });
    } catch (error) {
      if (controller.signal.aborted) return;
      setLookup({ state: 'error', message: error instanceof Error ? error.message : 'FlightRadar24 could not be reached.' });
    }
  };

  // Moving the date re-asks straight away once there are results on screen.
  const moveDate = (next: string) => {
    setChosenDate(next);
    if (lookup.state === 'choose' || lookup.state === 'none') void find(next);
  };

  return (
    <div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
        <label className="block">
          <span className={labelClass}>Flight or tail number</span>
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
            className={`${fieldClass} font-mono uppercase`}
          />
        </label>
        <div className="block">
          <span className={labelClass}>{arrival ? 'Arrival date (local)' : 'Departure date (local)'}</span>
          <div className="mt-1 flex items-center gap-1">
            <button
              type="button"
              aria-label="Day before"
              disabled={!hasDate}
              onClick={() => moveDate(shiftDay(lookupDate, -1))}
              className="h-9 w-8 shrink-0 rounded-lg bg-gray-50 text-sm text-gray-500 hover:bg-gray-100 disabled:opacity-40"
            >
              ‹
            </button>
            <input
              type="date"
              value={lookupDate}
              onChange={(e) => moveDate(e.target.value)}
              className="h-9 rounded-lg bg-gray-50 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <button
              type="button"
              aria-label="Day after"
              disabled={!hasDate}
              onClick={() => moveDate(shiftDay(lookupDate, 1))}
              className="h-9 w-8 shrink-0 rounded-lg bg-gray-50 text-sm text-gray-500 hover:bg-gray-100 disabled:opacity-40"
            >
              ›
            </button>
            <button
              type="button"
              onClick={() => void find()}
              disabled={!hasNumber || !hasDate || lookup.state === 'loading'}
              title={`Find this flight on the ${endWord} date`}
              className="h-9 shrink-0 rounded-lg bg-sky-600 px-3 text-xs font-semibold text-white transition hover:bg-sky-700 disabled:opacity-50"
            >
              {lookup.state === 'loading' ? 'Looking…' : 'Look up'}
            </button>
          </div>
        </div>
      </div>
      {hasNumber && !hasDate && (
        <p className="mt-1.5 text-xs text-amber-700">Which date? Enter the {endWord} date to look the flight up.</p>
      )}

      {lookup.state === 'choose' && (
        <div className="mt-2 overflow-hidden rounded-lg border border-gray-200 bg-white">
          <p className="border-b border-gray-100 bg-gray-50 px-3 py-1.5 text-[11px] font-medium text-gray-500">
            {value.trim().toUpperCase()} {arrival ? 'arriving' : 'departing'} {dayName(lookup.date)} · pick the leg to fill the form
          </p>
          <ul className="divide-y divide-gray-100" aria-label="Flights found">
            {lookup.candidates.map((c) => {
              const badge = dayBadge(c, lookup.date);
              return (
                <li key={`${c.flightNumber}-${c.origin?.iata}-${c.destination?.iata}`}>
                  <button type="button" onClick={() => pick(c, lookup.date)} className="flex w-full items-start gap-3 px-3 py-2 text-left transition hover:bg-sky-50">
                    <span className="w-16 shrink-0 pt-0.5 font-mono text-sm font-semibold text-gray-900">{c.flightNumber}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-gray-800">
                        {describeCandidate(c)}
                        {c.airline && <span className="text-gray-400"> · {c.airline.name}</span>}
                      </span>
                      {(c.departDate || c.arriveDate) && (
                        <span className="block text-[11px] text-gray-500">
                          {c.departDate && `Leaves ${c.origin?.iata ?? ''} ${dayName(c.departDate)}`}
                          {c.departDate && c.arriveDate && ' · '}
                          {c.arriveDate && `lands ${c.destination?.iata ?? ''} ${dayName(c.arriveDate)}`}
                          {c.departureEstimated && ' · departure estimated'}
                        </span>
                      )}
                    </span>
                    <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold ${badge.tone}`}>{badge.text}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {lookup.state === 'none' && (
        <p className="mt-1.5 text-xs text-amber-700">
          FlightRadar24 hasn’t seen {lookup.query} fly in the last two weeks, so there is nothing to go on for {dayName(lookup.date)}. Check the
          number, or fill the flight in from the ticket.
        </p>
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
