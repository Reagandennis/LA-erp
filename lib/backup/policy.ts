/**
 * When backups run and which snapshots are kept — pure functions over dates,
 * so the rules can be tested exactly. No I/O here.
 *
 * Retention is grandfather-father-son: the newest snapshot of each of the
 * last N days, the first snapshot of each of the last N weeks, and the first
 * of each of the last N months. "First" for weeks and months means a monthly
 * snapshot is known the moment it is taken, so it can be locked straight away.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') };
}

/** Milliseconds `timeZone` is ahead of UTC at `date`. */
function offsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return asUtc - Math.floor(date.getTime() / 60_000) * 60_000;
}

/** The instant a wall-clock time happens in `timeZone`. */
function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let instant = guess - offsetMs(new Date(guess), timeZone);
  // Across a DST change the first guess can land an hour out; one correction settles it.
  const corrected = guess - offsetMs(new Date(instant), timeZone);
  if (corrected !== instant) instant = corrected;
  return new Date(instant);
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function parseTime(value: string): { hour: number; minute: number } | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : null;
}

/** The most recent daily run time at or before `now`. */
export function lastScheduledAt(now: Date, time: string, timeZone: string): Date {
  const { hour, minute } = parseTime(time) ?? { hour: 2, minute: 0 };
  const today = zonedParts(now, timeZone);
  const candidate = zonedToUtc(today.year, today.month, today.day, hour, minute, timeZone);
  if (candidate <= now) return candidate;
  const yesterday = new Date(Date.UTC(today.year, today.month - 1, today.day) - DAY_MS);
  return zonedToUtc(yesterday.getUTCFullYear(), yesterday.getUTCMonth() + 1, yesterday.getUTCDate(), hour, minute, timeZone);
}

/** The next daily run time after `now`. */
export function nextScheduledAt(now: Date, time: string, timeZone: string): Date {
  const { hour, minute } = parseTime(time) ?? { hour: 2, minute: 0 };
  const today = zonedParts(now, timeZone);
  const candidate = zonedToUtc(today.year, today.month, today.day, hour, minute, timeZone);
  if (candidate > now) return candidate;
  const tomorrow = new Date(Date.UTC(today.year, today.month - 1, today.day) + DAY_MS);
  return zonedToUtc(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate(), hour, minute, timeZone);
}

/**
 * A scheduled run is due when the latest run time has passed and no
 * scheduled run has started since — which also catches up a run missed
 * because the server was down at the time.
 */
export function isDue(now: Date, time: string, timeZone: string, lastScheduledRunAt: Date | null): boolean {
  const slot = lastScheduledAt(now, time, timeZone);
  return !lastScheduledRunAt || lastScheduledRunAt < slot;
}

// --- Retention ---------------------------------------------------------------

export interface RetentionRule {
  keepDaily: number;
  keepWeekly: number;
  keepMonthly: number;
  timeZone: string;
}

export interface Snapshot {
  id: number;
  startedAt: Date;
  pinned: boolean;
}

function dayKey(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function monthKey(date: Date, timeZone: string): string {
  return dayKey(date, timeZone).slice(0, 7);
}

/** ISO-8601 week ("2026-W42") of the local calendar day. */
function weekKey(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  const day = new Date(Date.UTC(p.year, p.month - 1, p.day));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday); // Thursday decides the ISO year.
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((day.getTime() - yearStart) / DAY_MS + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Is this the first snapshot of its calendar month? (Monthly snapshots are locked.) */
export function isFirstOfMonth(snapshot: Snapshot, earlier: Snapshot[], timeZone: string): boolean {
  const key = monthKey(snapshot.startedAt, timeZone);
  return !earlier.some((s) => s.id !== snapshot.id && s.startedAt < snapshot.startedAt && monthKey(s.startedAt, timeZone) === key);
}

export interface RetentionDecision {
  keep: Map<number, Array<'daily' | 'weekly' | 'monthly' | 'pinned' | 'latest'>>;
  prune: number[];
}

/** Which snapshots stay, and why; everything else is pruned. */
export function applyRetention(snapshots: Snapshot[], rule: RetentionRule): RetentionDecision {
  const newestFirst = [...snapshots].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  const keep: RetentionDecision['keep'] = new Map();
  const mark = (id: number, reason: 'daily' | 'weekly' | 'monthly' | 'pinned' | 'latest') => {
    keep.set(id, [...(keep.get(id) ?? []), reason]);
  };

  // Never leave the platform without its newest backup, whatever the settings.
  if (newestFirst[0]) mark(newestFirst[0].id, 'latest');
  for (const s of newestFirst) if (s.pinned) mark(s.id, 'pinned');

  const days = new Set<string>();
  for (const s of newestFirst) {
    const key = dayKey(s.startedAt, rule.timeZone);
    if (days.has(key)) continue;
    if (days.size >= rule.keepDaily) break;
    days.add(key);
    mark(s.id, 'daily');
  }

  const firstOf = (keyOf: (d: Date, tz: string) => string, limit: number, reason: 'weekly' | 'monthly') => {
    const groups = new Map<string, Snapshot>();
    for (const s of newestFirst) groups.set(keyOf(s.startedAt, rule.timeZone), s); // oldest wins (iterating newest → oldest)
    const recent = [...groups.keys()].sort().reverse().slice(0, limit);
    for (const key of recent) mark(groups.get(key)!.id, reason);
  };
  firstOf(weekKey, rule.keepWeekly, 'weekly');
  firstOf(monthKey, rule.keepMonthly, 'monthly');

  return { keep, prune: newestFirst.filter((s) => !keep.has(s.id)).map((s) => s.id) };
}

/** Snapshot folder name: sorts by time in Drive and reads naturally. */
export function snapshotName(startedAt: Date, timeZone: string, trigger: string): string {
  const p = zonedParts(startedAt, timeZone);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}.${pad(p.minute)} (${trigger === 'schedule' ? 'scheduled' : trigger})`;
}
