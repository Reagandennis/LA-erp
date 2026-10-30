'use client';

import { Fragment, useState } from 'react';

import { useNow } from '@/app/ui/use-client';
import { APP_LOCALE } from '@/lib/locale';
import type { OpsMovement } from '@/lib/ops-dashboard';

import { EventRow } from './event-row';
import { LATE_AFTER_MS, type MovementState, movementState } from './ops-model';
import { Empty, Panel, type PanelFrame, Segmented, StackedBar, clock, mono, send } from './ops-ui';

type Filter = 'all' | 'open' | 'late';

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
  const count = (state: MovementState) => movements.filter((m) => states.get(m.id) === state).length;
  const late = count('late');
  const open = movements.length - count('done');
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
      title="Movements"
      summary={
        <>
          {open} open
          {late > 0 && (
            <>
              {' · '}
              <span className="text-rose-600">{late} late</span>
            </>
          )}
        </>
      }
      href="/modules/trip-planning"
      moduleName="Trip Planning"
      frame={frame}
      defaultCols={2}
      actions={
        <Segmented
          label="Show"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'open', label: 'Open' },
            { value: 'late', label: 'Late', ...(late > 0 ? { count: late, alert: true } : {}) },
          ]}
        />
      }
    >
      {now !== null && movements.length > 0 && (
        <div className="border-b border-gray-100 py-4">
          <StackedBar
            segments={[
              { label: 'done', value: count('done'), tone: 'good' },
              { label: 'ahead', value: count('upcoming'), tone: 'neutral' },
              { label: 'due now', value: count('now'), tone: 'warn' },
              { label: 'late', value: late, tone: 'danger' },
            ]}
          />
        </div>
      )}

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
              <li className="flex items-center gap-2 py-1.5" aria-label="Now">
                <span className="h-2 w-2 rounded-full bg-rose-500" />
                <span className="h-px flex-1 bg-rose-300" />
                <span className={`${mono} text-[10px] font-bold uppercase tracking-wider text-rose-500`}>Now {clock(new Date(now).toISOString())}</span>
              </li>
            );
            // The line belongs to today: above a later day's heading, below today's.
            const lineFirst = newDay && heading !== 'Today';
            return (
              <Fragment key={m.id}>
                {lineFirst && nowLine}
                {newDay && (
                  <li className="pb-1 pt-3 text-[10px] font-bold uppercase tracking-[0.15em] text-gray-400 first:pt-2">{heading}</li>
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
