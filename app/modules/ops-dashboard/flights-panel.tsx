'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { useNow } from '@/app/ui/use-client';
import { isTrackable, useFlightTrack } from '@/app/ui/use-flight-track';
import {
  type Punctuality,
  flightDirection,
  flightProgress,
  normalizeFlightNumber,
  scheduleCountdown,
  scheduledFlightTimes,
} from '@/lib/flight-status';
import type { OpsFlight } from '@/lib/ops-dashboard';
import { isValidTimeZone } from '@/lib/zoned-time';

import { reportFlightDelay } from './board-stores';
import { Check, Empty, Panel, type PanelFrame, clock, send, shortDate } from './ops-ui';

const CHIP: Record<Punctuality, string> = {
  early: 'bg-sky-50 text-sky-700 ring-sky-200',
  ontime: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  late: 'bg-rose-50 text-rose-700 ring-rose-200',
  unknown: 'bg-slate-50 text-slate-500 ring-slate-200',
};

const TAKEOFF_ICON =
  'M2.5 19h19v2h-19v-2zm19.57-9.36c-.21-.8-1.04-1.28-1.84-1.06L14.92 10l-6.9-6.43-1.93.51 4.14 7.17-4.97 1.33-1.97-1.54-1.45.39 2.59 4.49L21 11.49c.81-.23 1.28-1.05 1.07-1.85z';
const LANDING_ICON =
  'M2.5 19h19v2h-19v-2zm7.18-5.73l4.35 1.16 5.31 1.42c.8.21 1.62-.26 1.84-1.06.21-.8-.26-1.62-1.06-1.84l-5.31-1.42-2.76-9.02L10.12 2v8.28L5.15 8.95l-.93-2.32-1.45-.39v5.17l1.6.43 5.31 1.43z';

/** One flight with its FlightRadar24 status, looked up only once it is close (see use-flight-track). */
function FlightRow({
  flight,
  now,
  pending,
  onToggle,
}: Readonly<{ flight: OpsFlight; now: number | null; pending: boolean; onToggle: () => void }>) {
  const flightNumber = normalizeFlightNumber(flight.flightNumber);
  const arrival = flightDirection(flight.timeLabel) === 'arrival';
  const schedule = scheduledFlightTimes({
    direction: arrival ? 'arrival' : 'departure',
    scheduledAt: flight.scheduledAt,
    endsAt: flight.endsAt,
    durationMinutes: flight.durationMinutes,
  });
  const trackable = isTrackable(now, schedule);
  const { track, state } = useFlightTrack(flightNumber, schedule, trackable);
  const progress = now !== null ? flightProgress(now, schedule, track) : null;
  const countdown = now !== null ? scheduleCountdown(now, schedule) : null;

  const timeZone = flight.timezone && isValidTimeZone(flight.timezone) ? flight.timezone : undefined;
  const at = arrival ? schedule.arrival : schedule.departure;
  const chip =
    state === 'loading' && !track ? 'Checking…' : !flightNumber || !trackable ? 'Scheduled' : (progress?.label ?? 'Scheduled');
  const status = trackable && flightNumber ? (progress?.status ?? 'unknown') : 'unknown';

  // Delays go to the Needs attention bar too.
  const delay = status === 'late' && !flight.completed ? (progress?.label ?? null) : null;
  useEffect(() => reportFlightDelay(flight.id, delay), [flight.id, delay]);
  useEffect(() => () => reportFlightDelay(flight.id, null), [flight.id]);

  return (
    <li className={`flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-gray-50 ${flight.completed ? 'opacity-60' : ''}`}>
      <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${arrival ? 'bg-sky-100 text-sky-700' : 'bg-indigo-100 text-indigo-700'}`}>
        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path d={arrival ? LANDING_ICON : TAKEOFF_ICON} />
        </svg>
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-mono text-sm font-bold text-gray-900">{flight.flightNumber ?? 'No flight no.'}</span>
          <span className="font-mono text-xs font-semibold text-gray-500">
            {flight.from || track?.origin || '—'} → {flight.to || track?.destination || '—'}
          </span>
          {at && (
            // The flight's own zone when it has one, else the viewer's (which the server can't know).
            <span suppressHydrationWarning className="text-xs font-bold tabular-nums text-primary">
              {arrival ? 'Lands' : 'Departs'} {clock(at, timeZone)}
              <span suppressHydrationWarning className="font-medium text-gray-400"> · {shortDate(at, timeZone)}</span>
            </span>
          )}
        </div>
        <Link href={`/modules/trip-planning/${flight.tripId}`} className="block truncate text-xs text-gray-500 hover:text-primary">
          <span className="font-mono">{flight.tripReference}</span> · {flight.customer}
          {flight.airline && ` · ${flight.airline}`}
        </Link>
        <p className="truncate text-[11px] text-gray-400">
          {progress?.detail ?? countdown?.label ?? ''}
          {track?.eta && !track.landedAt && ` · ETA ${clock(track.eta, timeZone)}`}
          {track?.landedAt && ` · Landed ${clock(track.landedAt, timeZone)}`}
          {state === 'failed' && ' · FlightRadar24 unreachable, retrying'}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${CHIP[status]}`}>{chip}</span>
        {flight.canEdit && (
          <Check
            checked={flight.completed}
            disabled={pending}
            label={flight.completed ? 'Mark not handled' : arrival ? 'Mark met' : 'Mark seen off'}
            onChange={onToggle}
          />
        )}
      </div>
    </li>
  );
}

/** Flights on ongoing trips from 12 hours ago to 36 hours ahead. */
export default function FlightsPanel({
  flights,
  canOpenFlightTracker,
  frame,
  onChanged,
}: Readonly<{ flights: OpsFlight[]; canOpenFlightTracker: boolean; frame: PanelFrame; onChanged: () => Promise<void> }>) {
  const now = useNow(30_000);
  const [busy, setBusy] = useState<number | null>(null);

  const toggle = async (flight: OpsFlight) => {
    setBusy(flight.id);
    try {
      if (await send(`/api/trips/${flight.tripId}/items/${flight.id}`, 'PATCH', { completed: !flight.completed })) await onChanged();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel
      id="ops-flights"
      icon="flight-tracker"
      title="Flights"
      count={flights.filter((f) => !f.completed).length}
      href={canOpenFlightTracker ? '/modules/flight-tracker' : '/modules/trip-planning'}
      moduleName={canOpenFlightTracker ? 'Flight Tracker' : 'Trip Planning'}
      frame={frame}
    >
      {flights.length === 0 ? (
        <Empty>No flights on ongoing trips in the next 36 hours.</Empty>
      ) : (
        <ul className="space-y-0.5">
          {flights.map((flight) => (
            <FlightRow key={flight.id} flight={flight} now={now} pending={busy === flight.id} onToggle={() => void toggle(flight)} />
          ))}
        </ul>
      )}
    </Panel>
  );
}
