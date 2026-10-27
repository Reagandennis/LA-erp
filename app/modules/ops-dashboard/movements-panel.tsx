'use client';

import { Fragment, useState } from 'react';

import { useNow } from '@/app/ui/use-client';
import { APP_LOCALE } from '@/lib/locale';
import type { OpsMovement } from '@/lib/ops-dashboard';

import { EventRow } from './event-row';
import { LATE_AFTER_MS, movementState } from './ops-model';
import { Empty, Panel, type PanelFrame, clock, send } from './ops-ui';

type Filter = 'all' | 'open' | 'late';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'late', label: 'Late' },
];

/** "Today", "Tomorrow" or the date, in the viewer's zone. */
function dayHeading(iso: string, now: number): string {
  const key = (t: number) => new Date(t).toDateString();
  if (key(new Date(iso).getTime()) === key(now)) return 'Today';
  if (key(new Date(iso).getTime()) === key(now + 86_400_000)) return 'Tomorrow';
  return new Date(iso).toLocaleDateString(APP_LOCALE, { weekday: 'long', day: 'numeric', month: 'short' });
}

/**
 * Every itinerary event on the trips under way, from the start of today to a
 * day ahead, in time order with a line at the current time. Open events past
 * their time by a quarter of an hour show as late; tick them off from here.
 */
export default function MovementsPanel({
  movements,
  frame,
  onChanged,
}: Readonly<{ movements: OpsMovement[]; frame: PanelFrame; onChanged: () => Promise<void> }>) {
  const now = useNow(30_000);
  const [filter, setFilter] = useState<Filter>('all');
  const [busy, setBusy] = useState<number | null>(null);

  const states = new Map(movements.map((m) => [m.id, now === null ? 'upcoming' : movementState(m, now)] as const));
  const late = movements.filter((m) => states.get(m.id) === 'late').length;
  const open = movements.filter((m) => states.get(m.id) !== 'done').length;
  const shown = movements.filter((m) => (filter === 'all' ? true : filter === 'late' ? states.get(m.id) === 'late' : states.get(m.id) !== 'done'));
  // The "now" line goes before the first event that is still ahead.
  const firstAhead = now === null ? -1 : shown.findIndex((m) => new Date(m.scheduledAt).getTime() > now + LATE_AFTER_MS);

  const toggle = async (m: OpsMovement) => {
    setBusy(m.id);
    try {
      if (await send(`/api/trips/${m.tripId}/items/${m.id}`, 'PATCH', { completed: !m.completed })) await onChanged();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel
      id="ops-movements"
      icon="trip-planning"
      title="Movements"
      count={open}
      tone={late > 0 ? 'danger' : 'neutral'}
      href="/modules/trip-planning"
      moduleName="Trip Planning"
      frame={frame}
      defaultCols={2}
      actions={
        <div className="flex rounded-lg bg-gray-100 p-0.5" role="group" aria-label="Show">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              aria-pressed={filter === f.value}
              className={`rounded-md px-2 py-1 text-[11px] font-bold transition-colors ${
                filter === f.value ? 'bg-white text-primary shadow-sm' : 'text-gray-500 hover:text-primary'
              }`}
            >
              {f.label}
              {f.value === 'late' && late > 0 && <span className="ml-1 text-rose-600">{late}</span>}
            </button>
          ))}
        </div>
      }
    >
      {shown.length === 0 ? (
        <Empty>
          {movements.length === 0
            ? 'Nothing scheduled today or in the next 24 hours on Planned or Active trips. Drafts show once they’re planned.'
            : filter === 'late'
              ? 'Nothing is late.'
              : 'Everything is done.'}
        </Empty>
      ) : (
        <ol>
          {shown.map((m, i) => {
            const state = states.get(m.id) ?? 'upcoming';
            const heading = now !== null ? dayHeading(m.scheduledAt, now) : null;
            const newDay = heading !== null && (i === 0 || dayHeading(shown[i - 1]!.scheduledAt, now!) !== heading);
            const nowLine = i === firstAhead && now !== null && (
              <li className="flex items-center gap-2 px-3 py-1" aria-label="Now">
                <span className="h-2 w-2 rounded-full bg-rose-500" />
                <span className="h-px flex-1 bg-rose-300" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-rose-500">Now {clock(new Date(now).toISOString())}</span>
              </li>
            );
            // The line belongs to today: above a later day's heading, below today's.
            const lineFirst = newDay && heading !== 'Today';
            return (
              <Fragment key={m.id}>
                {lineFirst && nowLine}
                {newDay && (
                  <li className="px-3 pb-1 pt-3 text-[10px] font-bold uppercase tracking-[0.15em] text-gray-400 first:pt-1">{heading}</li>
                )}
                {!lineFirst && nowLine}
                <EventRow
                  event={m}
                  state={state}
                  now={now}
                  canEdit={m.canEdit}
                  pending={busy === m.id}
                  onToggle={() => void toggle(m)}
                  trip={{ id: m.tripId, reference: m.reference, customer: m.customer }}
                />
              </Fragment>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
