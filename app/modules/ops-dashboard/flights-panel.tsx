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
import { Check, Empty, Panel, type PanelFrame, Pill, type Tone, clock, mono, rowClass, send, shortDate, subClass } from './ops-ui';

const PUNCTUALITY: Record<Punctuality, Tone> = { early: 'info', ontime: 'good', late: 'danger', unknown: 'neutral' };

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

  const detail = [
    at ? `${arrival ? 'Lands' : 'Departs'} ${shortDate(at, timeZone)}` : null,
    progress?.detail ?? countdown?.label ?? null,
    track?.eta && !track.landedAt ? `ETA ${clock(track.eta, timeZone)}` : null,
    track?.landedAt ? `Landed ${clock(track.landedAt, timeZone)}` : null,
    state === 'failed' ? 'FlightRadar24 unreachable, retrying' : null,
  ].filter(Boolean);

  return (
    <li className={`${rowClass} ${flight.completed ? 'opacity-60' : ''}`}>
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${arrival ? 'bg-sky-100 text-sky-700' : 'bg-indigo-100 text-indigo-700'}`}
        title={arrival ? 'Arrival' : 'Departure'}
      >
        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path d={arrival ? LANDING_ICON : TAKEOFF_ICON} />
        </svg>
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-gray-900">
          <span className={mono}>{flight.flightNumber ?? 'No flight no.'}</span>
          <span className="text-gray-500">
            {' · '}
            {flight.from || track?.origin || '—'} → {flight.to || track?.destination || '—'}
          </span>
        </p>
        <Link href={`/modules/trip-planning/${flight.tripId}`} className={`${subClass} hover:text-primary`}>
          <span className={mono}>{flight.tripReference}</span> · {flight.customer}
          {flight.airline && ` · ${flight.airline}`}
        </Link>
        {detail.length > 0 && <p suppressHydrationWarning className="truncate text-[11px] text-gray-400">{detail.join(' · ')}</p>}
      </div>
      {at && (
        // The flight's own zone when it has one, else the viewer's (which the server can't know).
        <span suppressHydrationWarning className={`${mono} shrink-0 text-sm tabular-nums text-gray-700`} title={arrival ? 'Lands' : 'Departs'}>
          {clock(at, timeZone)}
        </span>
      )}
      <Pill tone={PUNCTUALITY[status]}>{chip}</Pill>
      {flight.canEdit && (
        <Check
          checked={flight.completed}
          disabled={pending}
          label={flight.completed ? 'Mark not handled' : arrival ? 'Mark met' : 'Mark seen off'}
          onChange={onToggle}
        />
      )}
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
  const open = flights.filter((f) => !f.completed).length;

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
      title="Flights"
      summary={`${open} in the next 36h`}
      href={canOpenFlightTracker ? '/modules/flight-tracker' : '/modules/trip-planning'}
      moduleName={canOpenFlightTracker ? 'Flight Tracker' : 'Trip Planning'}
      frame={frame}
    >
      {flights.length === 0 ? (
        <Empty>No flights on ongoing trips in the next 36 hours.</Empty>
      ) : (
        <ul>
          {flights.map((flight) => (
            <FlightRow key={flight.id} flight={flight} now={now} pending={busy === flight.id} onToggle={() => void toggle(flight)} />
          ))}
        </ul>
      )}
    </Panel>
  );
}
