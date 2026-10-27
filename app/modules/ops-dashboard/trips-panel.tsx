'use client';

import Link from 'next/link';
import { type ReactNode, useState } from 'react';

import { useNow } from '@/app/ui/use-client';
import type { OpsFlight, OpsTrip, OpsTripEvent, OpsTrips } from '@/lib/ops-dashboard';
import { SERVICE_COUNTRY_CODES } from '@/lib/service-catalog';

import { useFlightDelays } from './board-stores';
import { EventRow, STATE_STYLE, stateLabel } from './event-row';
import { type HealthLevel, type MovementState, type TripHealth, compareTrips, movementState, overdueLabel, tripHealth } from './ops-model';
import { Empty, Panel, type PanelFrame, RowButton, ago, clock, fieldClass, send, shortDate } from './ops-ui';

/** The strip shows from six hours ago to eighteen ahead, so "now" sits a quarter of the way in. */
const AXIS_BEFORE_MS = 6 * 3_600_000;
const AXIS_AFTER_MS = 18 * 3_600_000;
const AXIS_SPAN_MS = AXIS_BEFORE_MS + AXIS_AFTER_MS;

// Trip, its day, how it stands.
const ROW_GRID = 'md:grid md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_minmax(0,14rem)] md:items-center md:gap-x-5';

const LEVEL_STYLE: Record<HealthLevel, { dot: string; chip: string }> = {
  danger: { dot: 'bg-rose-500', chip: 'bg-rose-100 text-rose-700' },
  warn: { dot: 'bg-amber-400', chip: 'bg-amber-100 text-amber-800' },
  live: { dot: 'bg-sky-500', chip: 'bg-sky-100 text-sky-800' },
  ok: { dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700' },
  idle: { dot: 'bg-gray-300', chip: 'bg-gray-100 text-gray-500' },
};

function healthLabel(health: TripHealth): string {
  switch (health.reason) {
    case 'escalated':
      return 'Escalated';
    case 'delayed':
      return health.detail ?? 'Flight delayed';
    case 'late':
      return `${health.late} late`;
    case 'not-started':
      return 'Should have started';
    case 'overrun':
      return 'Ended · still Active';
    case 'in-progress':
      return 'In progress';
    case 'upcoming':
      return 'On track';
    case 'done':
      return 'Done for today';
    case 'quiet':
      return 'Nothing scheduled';
  }
}

type Filter = 'all' | 'attention' | 'mine';

// ---------------------------------------------------------------- the day strip

/** Local hours on the strip's axis that fall on a multiple of three. */
function axisTicks(start: number): number[] {
  const tick = new Date(start);
  tick.setMinutes(0, 0, 0);
  const ticks: number[] = [];
  while (tick.getTime() <= start + AXIS_SPAN_MS) {
    if (tick.getTime() >= start && tick.getHours() % 3 === 0) ticks.push(tick.getTime());
    tick.setHours(tick.getHours() + 1);
  }
  return ticks;
}

const position = (t: number, start: number) => `${Math.min(100, Math.max(0, ((t - start) / AXIS_SPAN_MS) * 100))}%`;

function AxisHeader({ now }: Readonly<{ now: number }>) {
  const start = now - AXIS_BEFORE_MS;
  return (
    <div className={`hidden px-3 pb-1 md:grid ${ROW_GRID}`} aria-hidden="true">
      <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-400">Trip</span>
      <div className="relative h-4">
        {axisTicks(start).map((t) => (
          <span key={t} className="absolute -translate-x-1/2 text-[10px] tabular-nums text-gray-400" style={{ left: position(t, start) }}>
            {clock(new Date(t).toISOString())}
          </span>
        ))}
        <span className="absolute -translate-x-1/2 rounded bg-rose-500 px-1 text-[9px] font-bold uppercase text-white" style={{ left: position(now, start) }}>
          Now
        </span>
      </div>
      <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-400">Status · next</span>
    </div>
  );
}

/** The trip's events on a line from six hours ago to eighteen ahead, coloured by how each stands. */
function DayStrip({ events, states, now }: Readonly<{ events: OpsTripEvent[]; states: MovementState[]; now: number }>) {
  const start = now - AXIS_BEFORE_MS;
  return (
    <div className="relative h-7">
      <span className="absolute inset-x-0 top-1/2 h-px bg-gray-200" />
      {axisTicks(start).map((t) => (
        <span key={t} className="absolute inset-y-1 w-px bg-gray-100" style={{ left: position(t, start) }} />
      ))}
      <span className="absolute inset-y-0 w-0.5 -translate-x-1/2 rounded bg-rose-400" style={{ left: position(now, start) }} />
      {events.map((event, i) => {
        const at = new Date(event.scheduledAt).getTime();
        const offAxis = at < start || at > start + AXIS_SPAN_MS;
        const state = states[i]!;
        return (
          <span
            key={event.id}
            title={`${clock(event.scheduledAt)} ${event.flightNumber ? `${event.flightNumber} ` : ''}${event.description} · ${stateLabel(state, event.scheduledAt, now)}`}
            className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 ring-2 ring-white ${STATE_STYLE[state].dot} ${
              event.category === 'flight' ? 'rotate-45 rounded-sm' : 'rounded-full'
            } ${offAxis ? 'opacity-40' : ''}`}
            style={{ left: position(at, start) }}
          />
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- one trip

type LogForm = { detail: string; receivedFrom: string; escalated: boolean };

/** One trip's log, written from the board: what happened, who reported it, escalate or not. */
function LogUpdate({ trip, onSaved, onCancel }: Readonly<{ trip: OpsTrip; onSaved: () => Promise<void>; onCancel: () => void }>) {
  const [form, setForm] = useState<LogForm>({ detail: '', receivedFrom: '', escalated: false });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.detail.trim()) return;
    setSaving(true);
    try {
      const ok = await send(`/api/trips/${trip.id}/log`, 'POST', {
        detail: form.detail.trim(),
        receivedFrom: form.receivedFrom.trim() || null,
        escalated: form.escalated,
      });
      if (ok) await onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="space-y-2 rounded-xl border border-gray-200 bg-white p-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <textarea
        autoFocus
        rows={2}
        value={form.detail}
        onChange={(e) => setForm({ ...form, detail: e.target.value })}
        maxLength={4000}
        placeholder={`What happened on ${trip.reference}?`}
        aria-label="What happened"
        className={`${fieldClass} resize-none`}
      />
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={form.receivedFrom}
          onChange={(e) => setForm({ ...form, receivedFrom: e.target.value })}
          maxLength={200}
          placeholder="Reported by (optional)"
          aria-label="Reported by"
          className={`${fieldClass} min-w-0 flex-1`}
        />
        <label className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-rose-700">
          <input
            type="checkbox"
            checked={form.escalated}
            onChange={(e) => setForm({ ...form, escalated: e.target.checked })}
            className="h-4 w-4 rounded border-gray-300 accent-rose-600"
          />
          Escalate
        </label>
        <button type="button" onClick={onCancel} className="shrink-0 px-2 py-1.5 text-xs font-bold text-gray-500 hover:text-gray-700">
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving || !form.detail.trim()}
          className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Add to log'}
        </button>
      </div>
    </form>
  );
}

function Fact({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-gray-400">{label}</dt>
      <dd className="truncate text-xs text-gray-800">{children}</dd>
    </div>
  );
}

function TripRow({
  trip,
  health,
  states,
  now,
  escalation,
  open,
  onToggleOpen,
  onChanged,
}: Readonly<{
  trip: OpsTrip;
  health: TripHealth | null;
  states: MovementState[];
  now: number | null;
  escalation: string | null;
  open: boolean;
  onToggleOpen: () => void;
  onChanged: () => Promise<void>;
}>) {
  const [busy, setBusy] = useState<string | null>(null);
  const [logging, setLogging] = useState(false);
  const active = trip.status === 'Active';
  const level = LEVEL_STYLE[health?.level ?? 'idle'];
  const code = trip.country ? (SERVICE_COUNTRY_CODES as Record<string, string>)[trip.country] : null;

  const run = async (key: string, work: () => Promise<boolean>) => {
    setBusy(key);
    try {
      if (await work()) await onChanged();
    } finally {
      setBusy(null);
    }
  };
  const setStatus = (status: 'Active' | 'Completed') => {
    if (status === 'Completed' && !window.confirm(`Mark ${trip.reference} as completed?`)) return;
    void run('status', () => send(`/api/trips/${trip.id}`, 'PATCH', { status }));
  };
  const statusButton =
    trip.canEdit &&
    (active ? (
      <RowButton onClick={() => setStatus('Completed')} disabled={busy === 'status'}>
        Complete
      </RowButton>
    ) : (
      <RowButton tone="good" onClick={() => setStatus('Active')} disabled={busy === 'status'}>
        Start
      </RowButton>
    ));
  // The fix for the warning on the row, offered on the row itself.
  const quickAction = health?.reason === 'not-started' || health?.reason === 'overrun' ? statusButton : null;
  const next = health?.next ?? null;

  return (
    <li className={`rounded-xl border transition-colors ${open ? 'border-primary/20 bg-white shadow-sm' : 'border-gray-100 hover:border-gray-200'}`}>
      <div className={`px-3 py-2.5 ${ROW_GRID}`}>
        <div className="flex min-w-0 items-start gap-2">
          <button
            type="button"
            onClick={onToggleOpen}
            aria-expanded={open}
            aria-label={open ? `Close ${trip.reference}` : `Open ${trip.reference}`}
            className="mt-0.5 rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-primary"
          >
            <svg className={`h-4 w-4 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
            </svg>
          </button>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5">
              <span className={`h-2 w-2 shrink-0 rounded-full ${level.dot}`} aria-hidden="true" />
              <Link href={`/modules/trip-planning/${trip.id}`} className="truncate font-mono text-xs font-bold text-gray-900 hover:text-primary">
                {trip.reference}
              </Link>
              {code && <span className="shrink-0 rounded bg-gray-100 px-1 text-[9px] font-bold text-gray-500">{code}</span>}
              {trip.mine && <span className="shrink-0 rounded bg-primary/10 px-1 text-[9px] font-bold text-primary">YOURS</span>}
            </p>
            <button type="button" onClick={onToggleOpen} className="block w-full truncate text-left text-xs text-gray-600 hover:text-primary">
              {trip.customer} · {trip.title}
            </button>
          </div>
        </div>

        <div className="mt-2 md:mt-0">
          {now !== null && trip.events.length > 0 ? (
            <div className="hidden md:block">
              <DayStrip events={trip.events} states={states} now={now} />
            </div>
          ) : (
            <p className="hidden text-center text-[11px] text-gray-300 md:block">{now !== null && 'Nothing on the itinerary in this window'}</p>
          )}
        </div>

        <div className="mt-1.5 flex items-start justify-between gap-2 md:mt-0">
          <div className="min-w-0">
            {health && (
              <span className={`inline-block max-w-full truncate rounded-full px-2 py-0.5 text-[11px] font-bold ${level.chip}`}>{healthLabel(health)}</span>
            )}
            {now !== null && (
              <p className="mt-0.5 truncate text-[11px] text-gray-500">
                {health && health.total > 0 && `${health.done}/${health.total} done`}
                {next && ` · next ${clock(next.scheduledAt)} ${next.description}`}
                {next && new Date(next.scheduledAt).getTime() > now && ` (in ${overdueLabel(new Date(next.scheduledAt).getTime() - now, true)})`}
              </p>
            )}
          </div>
          {quickAction}
        </div>
      </div>

      {open && (
        <div className="grid gap-3 border-t border-gray-100 bg-gray-50/60 p-3 lg:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="min-w-0">
            {trip.events.length === 0 ? (
              <p className="py-4 text-center text-xs text-gray-400">Nothing on the itinerary from the start of today to 24 hours ahead.</p>
            ) : (
              <ol className="space-y-0.5">
                {trip.events.map((event, i) => (
                  <EventRow
                    key={event.id}
                    event={event}
                    state={states[i] ?? 'upcoming'}
                    now={now}
                    canEdit={trip.canEdit}
                    pending={busy === `event-${event.id}`}
                    onToggle={() =>
                      void run(`event-${event.id}`, () => send(`/api/trips/${trip.id}/items/${event.id}`, 'PATCH', { completed: !event.completed }))
                    }
                  />
                ))}
              </ol>
            )}
            {logging && (
              <div className="mt-2">
                <LogUpdate
                  trip={trip}
                  onCancel={() => setLogging(false)}
                  onSaved={async () => {
                    setLogging(false);
                    await onChanged();
                  }}
                />
              </div>
            )}
          </div>

          <div className="space-y-3 rounded-xl border border-gray-100 bg-white p-3">
            <dl className="grid grid-cols-2 gap-2">
              <Fact label="Controller">{trip.controller ?? '—'}</Fact>
              <Fact label="Status">{trip.status}</Fact>
              <Fact label="Dates">
                <span suppressHydrationWarning>
                  {trip.startDate ? shortDate(trip.startDate) : '—'}
                  {trip.endDate && ` → ${shortDate(trip.endDate)}`}
                </span>
              </Fact>
              <Fact label="Country">{trip.country ?? '—'}</Fact>
              <div className="col-span-2">
                <Fact label="Crew">{trip.crew ?? 'None assigned'}</Fact>
              </div>
            </dl>
            {escalation && (
              <p className="rounded-lg bg-rose-50 px-2.5 py-1.5 text-xs text-rose-800">
                <span className="font-bold">Escalated: </span>
                {escalation}
              </p>
            )}
            {trip.lastLog && (
              <p className="text-xs text-gray-600" title={trip.lastLog.detail}>
                <span className="font-bold text-gray-400">Last log {ago(trip.lastLog.at, now)}: </span>
                {trip.lastLog.detail}
                {trip.lastLog.by && <span className="text-gray-400"> · {trip.lastLog.by}</span>}
              </p>
            )}
            <div className="flex flex-wrap gap-1.5">
              <RowButton onClick={() => setLogging((l) => !l)}>{logging ? 'Close log' : 'Log update'}</RowButton>
              {statusButton}
              <Link
                href={`/modules/trip-planning/${trip.id}`}
                className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-bold text-gray-600 transition-colors hover:border-primary/30 hover:text-primary"
              >
                Open trip →
              </Link>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------- the board

/**
 * Every trip under way as one row: how it stands, its day on a timeline, and
 * what's next. Trips with a problem come first. Open a row to tick off its
 * events, log what happens, or start and close it.
 */
export default function TripsPanel({
  data,
  flights,
  frame,
  onChanged,
}: Readonly<{ data: OpsTrips; flights: OpsFlight[]; frame: PanelFrame; onChanged: () => Promise<void> }>) {
  const now = useNow(30_000);
  const delays = useFlightDelays();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());

  const escalationOf = new Map<number, string>();
  for (const e of data.escalations) if (!escalationOf.has(e.tripId)) escalationOf.set(e.tripId, e.detail);
  const delayOf = new Map<number, string>();
  for (const d of delays) {
    const flight = flights.find((f) => f.id === d.id);
    if (flight && !delayOf.has(flight.tripId)) delayOf.set(flight.tripId, `${flight.flightNumber ?? 'Flight'} · ${d.label}`);
  }

  const rows = data.trips.map((trip) => ({
    trip,
    states: now === null ? trip.events.map(() => 'upcoming' as MovementState) : trip.events.map((e) => movementState(e, now)),
    health: now === null ? null : tripHealth(trip, now, { escalated: escalationOf.has(trip.id), delayedFlight: delayOf.get(trip.id) ?? null }),
  }));
  if (now !== null) rows.sort((a, b) => compareTrips({ trip: a.trip, health: a.health! }, { trip: b.trip, health: b.health! }));

  const needsAttention = (h: TripHealth | null) => h !== null && (h.level === 'danger' || h.level === 'warn');
  const attention = rows.filter((r) => needsAttention(r.health)).length;
  const mine = rows.filter((r) => r.trip.mine).length;
  const needle = query.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      (filter === 'all' || (filter === 'attention' ? needsAttention(r.health) : r.trip.mine)) &&
      (!needle ||
        [r.trip.reference, r.trip.customer, r.trip.title, r.trip.controller ?? ''].some((v) => v.toLowerCase().includes(needle))),
  );
  const tally = (level: HealthLevel) => rows.filter((r) => r.health?.level === level).length;

  const filters: { value: Filter; label: string; count?: number }[] = [
    { value: 'all', label: 'All', count: rows.length },
    { value: 'attention', label: 'Attention', count: attention },
    // Everyone but an admin only sees their own trips, so "Mine" would say nothing new.
    ...(mine < rows.length ? [{ value: 'mine' as const, label: 'Mine', count: mine }] : []),
  ];

  return (
    <Panel
      id="ops-trips"
      icon="trip-planning"
      title="Trip board"
      count={rows.length}
      tone={tally('danger') > 0 ? 'danger' : attention > 0 ? 'warn' : 'good'}
      href="/modules/trip-planning"
      moduleName="Trip Planning"
      frame={frame}
      defaultCols={3}
      actions={
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a trip…"
            aria-label="Find a trip"
            className="hidden w-36 rounded-lg border border-gray-200 px-2.5 py-1 text-xs focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/15 sm:block"
          />
          <div className="flex rounded-lg bg-gray-100 p-0.5" role="group" aria-label="Show">
            {filters.map((f) => (
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
                {f.count !== undefined && (
                  <span className={`ml-1 tabular-nums ${f.value === 'attention' && f.count > 0 ? 'text-rose-600' : 'text-gray-400'}`}>{f.count}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      }
    >
      {rows.length === 0 ? (
        <Empty>No trips under way, starting within two days, or with anything on the itinerary in the next 24 hours.</Empty>
      ) : (
        <>
          {now !== null && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 px-3 pb-2 pt-1 text-xs text-gray-500">
              {(
                [
                  ['danger', 'need action'],
                  ['warn', 'to check'],
                  ['live', 'in progress'],
                  ['ok', 'on track'],
                  ['idle', 'quiet'],
                ] as const
              )
                .filter(([level]) => tally(level) > 0)
                .map(([level, label]) => (
                  <span key={level} className="flex items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${LEVEL_STYLE[level].dot}`} />
                    <span className="font-bold text-gray-700">{tally(level)}</span> {label}
                  </span>
                ))}
              {data.active + data.startingSoon > data.trips.length && (
                <span className="text-gray-400">Showing {data.trips.length} of {data.active + data.startingSoon}</span>
              )}
            </div>
          )}
          {now !== null && shown.length > 0 && <AxisHeader now={now} />}
          {shown.length === 0 ? (
            <Empty>{needle ? `No trip matches “${query.trim()}”.` : filter === 'attention' ? 'No trip needs attention.' : 'None of these trips are yours.'}</Empty>
          ) : (
            <ul className="space-y-1.5">
              {shown.map(({ trip, health, states }) => (
                <TripRow
                  key={trip.id}
                  trip={trip}
                  health={health}
                  states={states}
                  now={now}
                  escalation={escalationOf.get(trip.id) ?? null}
                  open={open.has(trip.id)}
                  onToggleOpen={() =>
                    setOpen((current) => {
                      const next = new Set(current);
                      if (next.has(trip.id)) next.delete(trip.id);
                      else next.add(trip.id);
                      return next;
                    })
                  }
                  onChanged={onChanged}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </Panel>
  );
}
