'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

import type { OpsTripEvent } from '@/lib/ops-dashboard';

import { type MovementState, overdueLabel } from './ops-model';
import { Check, Pill, type Tone, clock, mono, rowClass, subClass } from './ops-ui';

/** Outline icons for the itinerary categories (trip-planning's categories.ts). */
export const CATEGORY_ICON: Record<string, string> = {
  flight: 'M12 19l9 2-9-18-9 18 9-2zm0 0v-8',
  transportation:
    'M9 17a2 2 0 11-4 0 2 2 0 014 0zm10 0a2 2 0 11-4 0 2 2 0 014 0zM13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1',
  lodging: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
  activity: 'M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9',
  tour: 'M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9',
  booking: 'M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z',
  information: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
};

/** The pill colour for how a movement stands. */
export const STATE_TONE: Record<MovementState, Tone> = { done: 'good', late: 'danger', now: 'warn', upcoming: 'neutral' };

export function stateLabel(state: MovementState, at: string, now: number): string {
  const ms = new Date(at).getTime() - now;
  if (state === 'done') return 'Done';
  if (state === 'late') return `${overdueLabel(ms, true)} late`;
  if (state === 'now') return ms > 0 ? `In ${overdueLabel(ms, true)}` : 'Now';
  return `In ${overdueLabel(ms, true)}`;
}

/**
 * One itinerary event: tick it off, see its time, what it is, where, and how
 * it stands. `trip` adds the trip it belongs to, for lists across trips.
 */
export function EventRow({
  event,
  state,
  now,
  canEdit,
  pending,
  onToggle,
  trip,
}: Readonly<{
  event: OpsTripEvent;
  state: MovementState;
  now: number | null;
  canEdit: boolean;
  pending: boolean;
  onToggle: () => void;
  trip?: { id: number; reference: string; customer: string };
}>) {
  const subline: ReactNode = trip ? (
    <Link href={`/modules/trip-planning/${trip.id}`} className={`${subClass} hover:text-primary`}>
      <span className={mono}>{trip.reference}</span> · {trip.customer}
      {event.crew && ` · ${event.crew}`}
    </Link>
  ) : event.crew ? (
    <span className={subClass}>{event.crew}</span>
  ) : null;

  return (
    <li className={`${rowClass} items-start ${state === 'done' ? 'opacity-60' : ''}`}>
      <span className="pt-0.5">
        <Check checked={event.completed} disabled={!canEdit || pending} label={event.completed ? 'Mark not done' : 'Mark done'} onChange={onToggle} />
      </span>
      {/* Local time: the server's zone may not be the viewer's. */}
      <span
        suppressHydrationWarning
        className={`${mono} w-11 shrink-0 text-xs font-semibold tabular-nums ${state === 'late' ? 'text-rose-600' : state === 'now' ? 'text-amber-600' : 'text-gray-500'}`}
      >
        {clock(event.scheduledAt)}
      </span>
      <svg className="mt-px h-4 w-4 shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-label={event.category}>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={CATEGORY_ICON[event.category] ?? CATEGORY_ICON.activity} />
      </svg>
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm font-medium ${event.completed ? 'text-gray-500 line-through' : 'text-gray-900'}`}>
          {event.flightNumber && <span className={`${mono} mr-1`}>{event.flightNumber}</span>}
          {event.description}
          {event.placeName && <span className="font-normal text-gray-400"> · {event.placeName}</span>}
        </p>
        {subline}
      </div>
      {now !== null && <Pill tone={STATE_TONE[state]}>{stateLabel(state, event.scheduledAt, now)}</Pill>}
    </li>
  );
}
