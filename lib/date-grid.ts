/**
 * Client-safe calendar-grid maths.
 *
 * Every function here works in the *local* timezone and anchors at midday
 * before doing any arithmetic, so a DST transition inside a range never
 * shifts a day by one. Nothing in this file touches UTC, and nothing may
 * import `server-only` — the Gantt and the shift planner both run in the
 * browser.
 */

/** Midday-normalised, so adding days never trips over a DST boundary. */
export function atNoon(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(12, 0, 0, 0);
  return copy;
}

export function dateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(date: Date, days: number): Date {
  const copy = atNoon(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

/** Monday-first, matching the reference and most rota conventions. */
export function startOfWeek(date: Date): Date {
  const copy = atNoon(date);
  const day = copy.getDay(); // 0 = Sunday
  const delta = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + delta);
  return copy;
}

export function startOfMonth(date: Date): Date {
  const copy = atNoon(date);
  copy.setDate(1);
  return copy;
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: Date): number {
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

export function rangeOfDays(start: Date, count: number): Date[] {
  return Array.from({ length: count }, (_, i) => addDays(start, i));
}

/** The 6×7 grid a month view needs, padded from the Monday before the 1st. */
export function monthGrid(anchor: Date): Date[] {
  return rangeOfDays(startOfWeek(startOfMonth(anchor)), 42);
}

export function isSameDay(a: Date, b: Date): boolean {
  return dateKey(a) === dateKey(b);
}

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse a `YYYY-MM-DD` key — or the date half of a full ISO timestamp — into a
 * local midday Date.
 *
 * This is deliberately *not* `new Date(value)`. A bare `"2026-08-28"` is
 * parsed by the spec as UTC midnight, which lands on the 27th anywhere west of
 * Greenwich; feeding a stored `…T00:00:00.000Z` back through `new Date()` has
 * the same effect. Taking only the first ten characters and rebuilding from
 * local components means a task never drifts a column, no matter the viewer's
 * timezone or how many times the value round-trips through an
 * `<input type="date">`.
 */
export function parseDateKey(value: string | null | undefined): Date | null {
  if (!value) return null;
  const key = value.slice(0, 10);
  if (!DATE_KEY_RE.test(key)) return null;

  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  const day = Number(key.slice(8, 10));
  const parsed = new Date(year, month - 1, day, 12, 0, 0, 0);

  // Rejects impossible dates like 2026-02-31, which would silently roll over.
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }
  return parsed;
}

/** Whole days from `a` to `b`; negative when `b` precedes `a`. DST-safe. */
export function dayDiff(a: Date, b: Date): number {
  return Math.round((atNoon(b).getTime() - atNoon(a).getTime()) / 86_400_000);
}

export type ClampedRange = {
  start: Date;
  end: Date;
  /** Column count, always >= 1. */
  days: number;
  /** How many days were trimmed off the far end, if any. */
  overflowDays: number;
};

/**
 * Bound a date window to `maxDays` columns.
 *
 * Without this a single task dated decades out expands the grid to tens of
 * thousands of columns — one header cell plus one cell per row each — which
 * both wedges the browser and shrinks every bar below a pixel.
 */
export function clampRange(start: Date, end: Date, maxDays: number): ClampedRange {
  const from = atNoon(start);
  const cap = Math.max(1, Math.floor(maxDays));
  const span = dayDiff(from, end) + 1;

  if (span <= cap) {
    return { start: from, end: addDays(from, Math.max(0, span - 1)), days: Math.max(1, span), overflowDays: 0 };
  }
  return { start: from, end: addDays(from, cap - 1), days: cap, overflowDays: span - cap };
}

/**
 * Read the *local* calendar day out of a stored timestamp.
 *
 * Values coming back from the API are full instants (Prisma `DateTime`
 * serialised with `toISOString()`), and this module deliberately renders them
 * in local time — a task due at 09:00 on the 28th is due on the 28th for the
 * person looking at it. Slicing the first ten characters of the ISO string
 * instead would read the *UTC* day, which is the previous day for anyone east
 * of Greenwich after 21:00 local, and is what made bars land a column early.
 *
 * A bare `YYYY-MM-DD` is still accepted and treated as a local day, since JS
 * would otherwise parse it as UTC midnight and reintroduce the same shift.
 */
export function dayFromIso(value: string | null | undefined): Date | null {
  if (!value) return null;
  if (DATE_KEY_RE.test(value)) return parseDateKey(value);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : atNoon(parsed);
}

/** The `YYYY-MM-DD` a stored timestamp falls on locally. */
export function dateKeyFromIso(value: string | null | undefined): string | null {
  const day = dayFromIso(value);
  return day ? dateKey(day) : null;
}

/**
 * Turn a `YYYY-MM-DD` back into a storable instant — local midnight, so that
 * `dayFromIso` returns the same key it was given, in every timezone.
 */
export function isoFromDateKey(key: string | null | undefined): string | null {
  const day = parseDateKey(key);
  if (!day) return null;
  day.setHours(0, 0, 0, 0);
  return day.toISOString();
}
