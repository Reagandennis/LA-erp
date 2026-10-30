'use client';

import { APP_LOCALE } from '@/lib/locale';
import { useSyncExternalStore } from 'react';

import { isTrackable, useFlightTrack } from '@/app/ui/use-flight-track';
import {
  flightDirection,
  flightProgress,
  formatDuration,
  normalizeFlightNumber,
  scheduleCountdown,
  scheduledFlightTimes,
  type Punctuality,
} from '@/lib/flight-status';
import { isValidTimeZone } from '@/lib/zoned-time';

import type { TripItineraryItemSummary } from '../../types';
import { AttachmentStrip } from './attachment-strip';
import { CrewRow } from './crew-row';
import { TravelerRow } from './event-travelers';

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

const PUNCTUALITY_TEXT: Record<Punctuality, string> = {
  early: 'text-sky-700',
  ontime: 'text-emerald-700',
  late: 'text-rose-700',
  unknown: 'text-slate-500',
};

const TAKEOFF_ICON =
  'M2.5 19h19v2h-19v-2zm19.57-9.36c-.21-.8-1.04-1.28-1.84-1.06L14.92 10l-6.9-6.43-1.93.51 4.14 7.17-4.97 1.33-1.97-1.54-1.45.39 2.59 4.49L21 11.49c.81-.23 1.28-1.05 1.07-1.85z';
const LANDING_ICON =
  'M2.5 19h19v2h-19v-2zm7.18-5.73l4.35 1.16 5.31 1.42c.8.21 1.62-.26 1.84-1.06.21-.8-.26-1.62-1.06-1.84l-5.31-1.42-2.76-9.02L10.12 2v8.28L5.15 8.95l-.93-2.32-1.45-.39v5.17l1.6.43 5.31 1.43z';
const PLANE_ICON =
  'M21 16v-2l-8-5V3.5a1.5 1.5 0 00-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1L15 22v-1.5L13 19v-5.5L21 16z';

/** "14:30" and "GMT+3" in the flight's zone; the viewer's own when it has none. */
function zonedClock(iso: string | null, timeZone: string | undefined): { time: string; zone: string } {
  if (!iso) return { time: '--:--', zone: '' };
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { time: '--:--', zone: '' };
  const time = date.toLocaleTimeString(APP_LOCALE, { timeZone, hour: '2-digit', minute: '2-digit', hour12: false });
  const zone =
    new Intl.DateTimeFormat(APP_LOCALE, { timeZone, timeZoneName: 'short' })
      .formatToParts(date)
      .find((part) => part.type === 'timeZoneName')?.value ?? '';
  return { time, zone };
}

function zonedDate(iso: string | null, timeZone: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(APP_LOCALE, { timeZone, weekday: 'short', month: 'short', day: 'numeric' });
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
  const direction = flightDirection(item.timeLabel);
  const arrival = direction === 'arrival';
  const timeZone = details.timezone && isValidTimeZone(details.timezone) ? details.timezone : undefined;
  const schedule = scheduledFlightTimes({
    direction,
    scheduledAt: item.scheduledAt,
    endsAt: item.endsAt,
    durationMinutes: item.durationMinutes,
  });

  const now = useNow();
  const anchor = schedule.departure ?? schedule.arrival;
  const trackable = isTrackable(now, schedule);
  const { track, state } = useFlightTrack(flightNumber, schedule, trackable);

  const progress = now !== null ? flightProgress(now, schedule, track) : null;
  const countdown = now !== null ? scheduleCountdown(now, schedule) : null;
  const status = progress?.status ?? 'unknown';
  const style = PUNCTUALITY_STYLE[status];
  const done = item.completedAt !== null;

  const from = details.departAirport || track?.origin || '';
  const to = details.arriveAirport || track?.destination || '';
  const departs = zonedClock(schedule.departure, timeZone);
  const lands = zonedClock(schedule.arrival, timeZone);
  const eventDate = zonedDate(item.scheduledAt, timeZone);

  const chipText =
    state === 'loading' && !track
      ? 'Checking…'
      : !flightNumber || !trackable
        ? 'Scheduled'
        : (progress?.label ?? 'Scheduled');

  // The actual take-off once FR24 has seen it, else the scheduled departure.
  const takeoff = track?.takeoffAt
    ? { label: 'Took off', clock: zonedClock(track.takeoffAt, timeZone) }
    : { label: 'Departs', clock: departs };
  // Where it lands: the touchdown, the live ETA, then the schedule. The day
  // is named when it isn't the event's own.
  const landingAt = track?.landedAt ?? track?.eta ?? schedule.arrival;
  const landingDay = zonedDate(landingAt, timeZone);
  const landing = {
    label: track?.landedAt ? 'Landed' : track?.eta ? 'Lands (ETA)' : 'Lands',
    clock: track?.landedAt || track?.eta ? zonedClock(landingAt, timeZone) : lands,
    day: landingDay && landingDay !== eventDate ? landingDay : null,
  };
  // Early or late, and by how much, against the schedule.
  const punctuality =
    progress && progress.deltaMinutes !== null && progress.status !== 'unknown'
      ? progress.status === 'ontime'
        ? 'On time'
        : `${formatDuration(progress.deltaMinutes * 60_000)} ${progress.status}`
      : chipText;

  // The side of the route the event happens at reads strongest.
  const side = (active: boolean) => (active ? 'text-slate-900' : 'text-slate-400');

  return (
    <div
      className={`group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md ${
        done ? 'opacity-60' : ''
      }`}
    >
      {/* Direction, airline and the live verdict */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-sky-50 to-white px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-500 text-white">
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
              <path d={arrival ? LANDING_ICON : TAKEOFF_ICON} />
            </svg>
          </span>
          <span className="shrink-0 text-[11px] font-black uppercase tracking-widest text-sky-700">
            {arrival ? 'Arrival' : 'Departure'}
          </span>
          {item.providerName && (
            <p className="truncate text-xs font-semibold text-sky-900/70">· {item.providerName}</p>
          )}
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
          {chipText}
        </span>
      </div>

      <div className="px-4 py-4">
        {/* Route, times local to the flight's zone */}
        <div className="flex items-end gap-3">
          <div className="text-left">
            <p className={`font-mono text-2xl font-bold leading-none tracking-tight ${side(!arrival)}`}>{from || '—'}</p>
            <p className={`mt-1 text-sm font-semibold ${side(!arrival)}`}>
              {departs.time}
              {schedule.departure && departs.zone && (
                <span className="ml-1 text-[10px] font-medium text-slate-400">{departs.zone}</span>
              )}
            </p>
          </div>

          <div className="relative mb-6 flex-1">
            <div className="h-px w-full bg-gradient-to-r from-slate-200 via-sky-300 to-slate-200" />
            <svg
              className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rotate-90 text-sky-500"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d={PLANE_ICON} />
            </svg>
            {item.durationMinutes ? (
              <p className="absolute left-1/2 top-2 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium text-slate-400">
                {formatDuration(item.durationMinutes * 60_000)}
              </p>
            ) : null}
          </div>

          <div className="text-right">
            <p className={`font-mono text-2xl font-bold leading-none tracking-tight ${side(arrival)}`}>{to || '—'}</p>
            <p className={`mt-1 text-sm font-semibold ${side(arrival)}`}>
              {lands.time}
              {schedule.arrival && lands.zone && (
                <span className="ml-1 text-[10px] font-medium text-slate-400">{lands.zone}</span>
              )}
            </p>
          </div>
        </div>

        {/* Took off, lands and how that compares with the schedule */}
        <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 px-3 py-2">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">{takeoff.label}</p>
            <p className="font-mono text-sm font-semibold text-slate-800">
              {takeoff.clock.time}
              {takeoff.clock.zone && <span className="ml-1 text-[10px] font-medium text-slate-400">{takeoff.clock.zone}</span>}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">{landing.label}</p>
            <p className="font-mono text-sm font-semibold text-slate-800">
              {landing.clock.time}
              {landing.clock.zone && <span className="ml-1 text-[10px] font-medium text-slate-400">{landing.clock.zone}</span>}
              {landing.day && <span className="ml-1 text-[10px] font-medium text-slate-400">· {landing.day}</span>}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">Schedule</p>
            <p className={`text-sm font-semibold ${PUNCTUALITY_TEXT[status]}`}>{punctuality}</p>
          </div>
        </div>

        <p className={`mt-3 text-sm font-semibold ${countdown?.imminent || progress?.status === 'late' ? 'text-sky-700' : 'text-slate-500'}`}>
          {eventDate && <span className="text-slate-400">{eventDate} · </span>}
          {progress?.detail ?? countdown?.label ?? '—'}
        </p>

        {item.description && (
          <p className={`mt-1 text-base font-semibold ${done ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
            {item.description}
          </p>
        )}
        <TravelerRow item={item} />
        {item.body && <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-600">{item.body}</p>}

        {/* Boarding-pass style detail strip */}
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 border-t border-dashed border-slate-200 pt-3 empty:hidden">
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

        {track?.takeoffAt && !track.landedAt && (track.altFt != null || track.gspeedKt != null) && (
          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
            <span className="flex items-center gap-1 font-medium text-emerald-600">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              Live
            </span>
            {track.altFt != null && <span>{track.altFt.toLocaleString(APP_LOCALE)} ft</span>}
            {track.gspeedKt != null && <span>{track.gspeedKt} kt</span>}
          </p>
        )}
        {!flightNumber && (
          <p className="mt-3 text-[11px] text-slate-400">Add a flight number to track it on FlightRadar24.</p>
        )}
        {flightNumber && !anchor && (
          <p className="mt-3 text-[11px] text-slate-400">Add a date and time to track this flight.</p>
        )}
        {state === 'failed' && (
          <p className="mt-3 text-[11px] text-slate-400">Couldn&apos;t reach FlightRadar24. Trying again shortly.</p>
        )}

        <CrewRow item={item} />
        <AttachmentStrip attachments={item.attachments} />
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
