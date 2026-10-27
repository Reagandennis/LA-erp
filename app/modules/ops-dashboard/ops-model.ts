import { SERVICE_COUNTRIES } from '@/lib/service-catalog';
import type { OpsFlight, OpsMovement, OpsSections, OpsTrip, OpsTripEvent } from '@/lib/ops-dashboard';
import type { OpsPanelKey } from '@/lib/ops-panels';

/**
 * The board's own rules, kept apart from the components so they can be
 * tested: when a movement counts as late, what needs attention, and the
 * country filter.
 */

/** A movement still open this long after its time is late. */
export const LATE_AFTER_MS = 15 * 60_000;

export type MovementState = 'done' | 'late' | 'now' | 'upcoming';

export function movementState(m: Pick<OpsMovement | OpsTripEvent, 'scheduledAt' | 'completed' | 'category'>, now: number): MovementState {
  if (m.completed) return 'done';
  const delta = new Date(m.scheduledAt).getTime() - now;
  // A note on the itinerary is never late; it's information.
  if (delta < -LATE_AFTER_MS) return m.category === 'information' ? 'done' : 'late';
  if (delta <= LATE_AFTER_MS) return 'now';
  return 'upcoming';
}

// --- Country filter -------------------------------------------------------------

/** The countries the board's trips are in, in the naming master's order. */
export function countriesIn(sections: Partial<OpsSections>): string[] {
  const present = new Set<string>();
  for (const m of sections.movements ?? []) if (m.country) present.add(m.country);
  for (const t of sections.trips?.trips ?? []) if (t.country) present.add(t.country);
  for (const f of sections.flights ?? []) if (f.country) present.add(f.country);
  const known = SERVICE_COUNTRIES.filter((c) => present.has(c));
  return [...known, ...[...present].filter((c) => !(SERVICE_COUNTRIES as readonly string[]).includes(c)).sort()];
}

/** The trip panels narrowed to one country; the rest of the board isn't by country. */
export function byCountry(sections: Partial<OpsSections>, country: string): Partial<OpsSections> {
  if (!country) return sections;
  const keep = <T extends { country: string | null }>(rows: T[]) => rows.filter((r) => r.country === country);
  return {
    ...sections,
    movements: sections.movements && keep(sections.movements),
    flights: sections.flights && keep(sections.flights),
    trips: sections.trips && {
      ...sections.trips,
      trips: keep(sections.trips.trips),
      escalations: keep(sections.trips.escalations),
      // The totals are for the whole board; with a filter the list itself is the count.
      active: keep(sections.trips.trips).filter((t) => t.status === 'Active').length,
      startingSoon: keep(sections.trips.trips).filter((t) => t.status !== 'Active').length,
    },
  };
}

// --- Trip health ---------------------------------------------------------------

/** How a trip is doing, as one word the board can sort and colour by. */
export type HealthLevel = 'danger' | 'warn' | 'live' | 'ok' | 'idle';

export type HealthReason =
  | 'escalated'
  | 'delayed'
  | 'late'
  | 'not-started'
  | 'overrun'
  | 'in-progress'
  | 'upcoming'
  | 'done'
  | 'quiet';

export interface TripHealth {
  level: HealthLevel;
  reason: HealthReason;
  /** Lower is more urgent: the board sorts by it. */
  rank: number;
  /** A delayed flight's chip text, e.g. "KQ 101 · Delayed 45m". */
  detail: string | null;
  late: number;
  done: number;
  total: number;
  /** The first open event still ahead (or due now). */
  next: OpsTripEvent | null;
}

const REASON: Record<HealthReason, { level: HealthLevel; rank: number }> = {
  escalated: { level: 'danger', rank: 0 },
  delayed: { level: 'danger', rank: 1 },
  late: { level: 'danger', rank: 2 },
  'not-started': { level: 'warn', rank: 3 },
  overrun: { level: 'warn', rank: 4 },
  'in-progress': { level: 'live', rank: 5 },
  upcoming: { level: 'ok', rank: 6 },
  done: { level: 'ok', rank: 7 },
  quiet: { level: 'idle', rank: 8 },
};

function startOfDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * The one thing to know about a trip right now, most serious first: an
 * escalation in its log, a delayed flight, late events; then a trip still
 * Planned a day after its start, or still Active a day after its end; then
 * whether something is happening now, what is next, or that the day is done.
 */
export function tripHealth(
  trip: Pick<OpsTrip, 'status' | 'startDate' | 'endDate' | 'events'>,
  now: number,
  signals: { escalated?: boolean; delayedFlight?: string | null } = {},
): TripHealth {
  const states = trip.events.map((e) => movementState(e, now));
  const late = states.filter((s) => s === 'late').length;
  const done = states.filter((s) => s === 'done').length;
  const next = trip.events.find((e, i) => states[i] === 'now' || states[i] === 'upcoming') ?? null;
  const today = startOfDay(now);
  // A day's grace either side: a trip may start late in its first day, or close the day after it ends.
  const yesterday = today - 86_400_000;

  let reason: HealthReason;
  if (signals.escalated) reason = 'escalated';
  else if (signals.delayedFlight) reason = 'delayed';
  else if (late > 0) reason = 'late';
  else if (trip.status === 'Planned' && trip.startDate && new Date(trip.startDate).getTime() < today) reason = 'not-started';
  else if (trip.status === 'Active' && trip.endDate && new Date(trip.endDate).getTime() < yesterday) reason = 'overrun';
  else if (states.includes('now')) reason = 'in-progress';
  else if (next) reason = 'upcoming';
  else if (trip.events.length > 0) reason = 'done';
  else reason = 'quiet';

  return {
    ...REASON[reason],
    reason,
    detail: reason === 'delayed' ? (signals.delayedFlight ?? null) : null,
    late,
    done,
    total: trip.events.length,
    next,
  };
}

/** Problems first; then by what comes next; then by reference. */
export function compareTrips(a: { trip: OpsTrip; health: TripHealth }, b: { trip: OpsTrip; health: TripHealth }): number {
  const nextAt = (h: TripHealth) => (h.next ? new Date(h.next.scheduledAt).getTime() : Number.MAX_SAFE_INTEGER);
  return a.health.rank - b.health.rank || nextAt(a.health) - nextAt(b.health) || a.trip.reference.localeCompare(b.trip.reference);
}

// --- Needs attention ---------------------------------------------------------

export type AttentionTone = 'danger' | 'warn' | 'info';

export interface AttentionItem {
  key: string;
  tone: AttentionTone;
  /** The panel it comes from, for its icon. */
  panel: OpsPanelKey;
  title: string;
  detail: string | null;
  href: string;
}

const TONE_ORDER: Record<AttentionTone, number> = { danger: 0, warn: 1, info: 2 };

/** "25 min", "1h", "2h 37m": how far past its time something is. */
export function overdueLabel(ms: number, short = false): string {
  const minutes = Math.round(Math.abs(ms) / 60_000);
  if (minutes < 60) return short ? `${minutes}m` : `${minutes} min`;
  const rest = minutes % 60;
  return rest === 0 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 60)}h ${rest}m`;
}

/**
 * Everything on the visible panels that someone should act on, most urgent
 * first: escalations, delayed flights, late movements and urgent handovers,
 * then trips that should have started, overdue work, and unread chats.
 */
export function buildAttention(
  sections: Partial<OpsSections>,
  now: number,
  delayedFlights: ReadonlyArray<{ id: number; label: string }> = [],
  formatTime: (iso: string) => string = (iso) => iso.slice(11, 16),
): AttentionItem[] {
  const items: AttentionItem[] = [];
  const tripHref = (id: number) => `/modules/trip-planning/${id}`;

  for (const e of sections.trips?.escalations ?? []) {
    items.push({ key: `esc-${e.id}`, tone: 'danger', panel: 'trips', title: `Escalated · ${e.reference}`, detail: e.detail, href: tripHref(e.tripId) });
  }

  const flights = new Map<number, OpsFlight>((sections.flights ?? []).map((f) => [f.id, f]));
  for (const delay of delayedFlights) {
    const flight = flights.get(delay.id);
    if (!flight || flight.completed) continue;
    items.push({
      key: `flight-${flight.id}`,
      tone: 'danger',
      panel: 'flights',
      title: `${flight.flightNumber ?? 'Flight'} · ${delay.label}`,
      detail: `${flight.tripReference} · ${flight.customer}`,
      href: tripHref(flight.tripId),
    });
  }

  for (const m of sections.movements ?? []) {
    if (movementState(m, now) !== 'late') continue;
    items.push({
      key: `move-${m.id}`,
      tone: 'danger',
      panel: 'movements',
      title: `Not done: ${formatTime(m.scheduledAt)} ${m.description}`,
      detail: `${overdueLabel(now - new Date(m.scheduledAt).getTime())} overdue · ${m.reference}`,
      href: tripHref(m.tripId),
    });
  }

  for (const h of sections.handover?.items ?? []) {
    if (h.mine || (h.status !== 'Urgent' && h.status !== 'Attention')) continue;
    items.push({
      key: `handover-${h.id}`,
      tone: h.status === 'Urgent' ? 'danger' : 'warn',
      panel: 'handover',
      title: `${h.status} handover${h.author ? ` from ${h.author}` : ''}`,
      detail: h.summary,
      href: '#ops-handover',
    });
  }

  // A trip starting today is covered by its late movements; one still Planned a day on has been missed.
  for (const t of sections.trips?.trips ?? []) {
    if (t.status !== 'Planned' || tripHealth(t, now).reason !== 'not-started') continue;
    items.push({
      key: `start-${t.id}`,
      tone: 'warn',
      panel: 'trips',
      title: `${t.reference} should have started`,
      detail: `${t.title} · still Planned`,
      href: tripHref(t.id),
    });
  }

  const overrun = (sections.trips?.trips ?? []).filter((t) => tripHealth(t, now).reason === 'overrun').length;
  if (overrun > 0) {
    items.push({
      key: 'overrun',
      tone: 'warn',
      panel: 'trips',
      title: `${overrun} ${overrun === 1 ? 'trip has' : 'trips have'} ended but ${overrun === 1 ? 'is' : 'are'} still Active`,
      detail: 'Complete them from the trip board',
      href: '#ops-trips',
    });
  }

  const overdueTasks = sections.tasks?.overdue ?? 0;
  if (overdueTasks > 0) {
    items.push({ key: 'tasks', tone: 'warn', panel: 'tasks', title: `${overdueTasks} overdue ${overdueTasks === 1 ? 'task' : 'tasks'}`, detail: null, href: '#ops-tasks' });
  }

  const maintenance = sections.maintenance;
  const overdueWork = (maintenance?.overdue ?? 0) + (maintenance?.comingDue.filter((r) => r.overdue).length ?? 0);
  if (overdueWork > 0) {
    items.push({
      key: 'maintenance',
      tone: 'warn',
      panel: 'maintenance',
      title: `${overdueWork} maintenance ${overdueWork === 1 ? 'job' : 'jobs'} overdue`,
      detail: null,
      href: '#ops-maintenance',
    });
  }

  const unread = sections.whatsapp?.unreadChats ?? 0;
  if (unread > 0) {
    items.push({ key: 'whatsapp', tone: 'info', panel: 'whatsapp', title: `${unread} unread WhatsApp ${unread === 1 ? 'chat' : 'chats'}`, detail: null, href: '#ops-whatsapp' });
  }

  // Stable within a tone: the order above.
  return items.map((item, i) => ({ item, i })).sort((a, b) => TONE_ORDER[a.item.tone] - TONE_ORDER[b.item.tone] || a.i - b.i).map(({ item }) => item);
}

// --- Panel sizes -----------------------------------------------------------------

/** How many grid columns a panel spans on wide screens; one column below that. */
export type PanelCols = 1 | 2 | 3;

/** A panel's size as its viewer left it. Unset parts keep the panel's default. */
export interface PanelSize {
  cols?: PanelCols;
  /** The body's height in px. */
  height?: number;
}

export const PANEL_HEIGHT_MIN = 160;
export const PANEL_HEIGHT_MAX = 1600;
/** One arrow-key press on the resize handle. */
export const PANEL_HEIGHT_STEP = 40;

/** The span classes: two columns on xl screens, up to three on 2xl ones. */
export const SPAN_CLASS: Record<PanelCols, string> = { 1: '', 2: 'xl:col-span-2', 3: 'xl:col-span-2 2xl:col-span-3' };

export function clampHeight(px: number): number {
  return Math.min(PANEL_HEIGHT_MAX, Math.max(PANEL_HEIGHT_MIN, Math.round(px)));
}

export function clampCols(n: number): PanelCols {
  return Math.min(3, Math.max(1, Math.round(n))) as PanelCols;
}

/**
 * The span after dragging the corner `dx` px sideways, snapped to the grid's
 * column tracks. When the drag leaves the visible span as it was (a height-only
 * drag, or a three-column panel on a two-column screen), the chosen span stands.
 */
export function dragColumns(drag: {
  cols: PanelCols;
  /** Columns the grid has at this screen width. */
  columns: number;
  startWidth: number;
  dx: number;
  /** One column track's width, and the gap between tracks, in px. */
  track: number;
  gap: number;
}): PanelCols {
  if (drag.columns <= 1) return drag.cols;
  const visible = Math.min(drag.cols, drag.columns);
  const wanted = Math.min(drag.columns, clampCols((drag.startWidth + drag.dx + drag.gap) / (drag.track + drag.gap)));
  return wanted === visible ? drag.cols : clampCols(wanted);
}
