/**
 * Shift emails: what a person's upcoming published shifts look like as
 * calendar events, how they differ from what was last emailed, and the
 * iCalendar (.ics) file that carries them.
 *
 * Pure functions; lib/shift-notify.ts loads the rows and sends the mail.
 * Every shift has a stable UID (line + date), so opening a newer file updates
 * the same events in the calendar instead of adding copies, and a shift taken
 * off the roster goes out as a cancelled event.
 */

/** One day on a person's roster that belongs in their calendar. */
export interface CalendarShift {
  date: string;
  /** As written on the roster, e.g. "D", "SD-N", "LV". */
  code: string;
  name: string;
  /** 'HH:MM' local time; null for an all-day entry (on call, leave). */
  start: string | null;
  end: string | null;
}

/** A shift as last emailed, with the revision number calendars order updates by. */
export interface SentShift extends CalendarShift {
  seq: number;
  /** Taken off the roster; sent as a cancelled event. */
  cancelled?: boolean;
}

export type SentMap = Record<string, SentShift>;

export interface ShiftChange {
  before: SentShift;
  after: CalendarShift;
}

export interface ShiftDiff {
  /** New days in a month the person had not been sent before: a publish. */
  published: CalendarShift[];
  /** New days in a month already sent (a shift added later). */
  added: CalendarShift[];
  changed: ShiftChange[];
  removed: SentShift[];
}

export function sameShift(a: CalendarShift, b: CalendarShift): boolean {
  return a.code === b.code && a.start === b.start && a.end === b.end && a.name === b.name;
}

export function isEmptyDiff(diff: ShiftDiff): boolean {
  return diff.published.length + diff.added.length + diff.changed.length + diff.removed.length === 0;
}

/**
 * Compares what is on the roster now with what was last sent. `inScope` says
 * which dates the current list speaks for (upcoming days of published months):
 * a sent day outside it is kept as it was, so unpublishing a month for an edit
 * does not cancel everyone's shifts. Days before `today` are dropped.
 */
export function diffShifts(
  previous: SentMap,
  current: CalendarShift[],
  inScope: (date: string) => boolean,
  today: string,
): { diff: ShiftDiff; next: SentMap } {
  const diff: ShiftDiff = { published: [], added: [], changed: [], removed: [] };
  const next: SentMap = {};
  const sentMonths = new Set(
    Object.values(previous)
      .filter((s) => !s.cancelled)
      .map((s) => s.date.slice(0, 7)),
  );
  const now = new Map(current.map((s) => [s.date, s]));

  for (const [date, sent] of Object.entries(previous)) {
    if (date < today) continue;
    if (!inScope(date)) {
      next[date] = sent;
      continue;
    }
    const shift = now.get(date);
    if (!shift) {
      if (sent.cancelled) next[date] = sent;
      else {
        diff.removed.push(sent);
        next[date] = { ...sent, seq: sent.seq + 1, cancelled: true };
      }
    } else if (sent.cancelled) {
      diff.added.push(shift);
      next[date] = { ...shift, seq: sent.seq + 1 };
    } else if (!sameShift(sent, shift)) {
      diff.changed.push({ before: sent, after: shift });
      next[date] = { ...shift, seq: sent.seq + 1 };
    } else {
      next[date] = sent;
    }
  }
  for (const shift of current) {
    if (shift.date < today || !inScope(shift.date) || previous[shift.date]) continue;
    (sentMonths.has(shift.date.slice(0, 7)) ? diff.added : diff.published).push(shift);
    next[shift.date] = { ...shift, seq: 0 };
  }
  const byDate = (a: { date: string }, b: { date: string }) => a.date.localeCompare(b.date);
  diff.published.sort(byDate);
  diff.added.sort(byDate);
  diff.changed.sort((a, b) => a.after.date.localeCompare(b.after.date));
  diff.removed.sort(byDate);
  return { diff, next };
}

// --- iCalendar ---------------------------------------------------------------

function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Milliseconds the zone is ahead of UTC at an instant. */
function zoneOffset(timeZone: string, ms: number): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(ms));
    const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
    return asUtc - Math.floor(ms / 1000) * 1000;
  } catch {
    return 0;
  }
}

/** A local wall-clock time in a zone, as a UTC instant. */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [y, mo, d] = date.split('-').map(Number);
  const naive = Date.UTC(y as number, (mo as number) - 1, d as number, Math.floor(minutesOf(time) / 60), minutesOf(time) % 60);
  let ms = naive - zoneOffset(timeZone, naive);
  ms = naive - zoneOffset(timeZone, ms);
  return new Date(ms);
}

function utcStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function dateStamp(date: string): string {
  return date.replace(/-/g, '');
}

function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Folds a content line at 75 octets, as RFC 5545 asks. */
function fold(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let chunk = '';
  let size = 0;
  for (const char of line) {
    const n = Buffer.byteLength(char, 'utf8');
    const limit = out.length === 0 ? 75 : 74;
    if (size + n > limit) {
      out.push(chunk);
      chunk = '';
      size = 0;
    }
    chunk += char;
    size += n;
  }
  out.push(chunk);
  return out.join('\r\n ');
}

export interface CalendarOptions {
  /** Unique per roster line, e.g. the line id. */
  uidPrefix: string;
  uidDomain: string;
  timeZone: string;
  calendarName: string;
  /** Shown in each event's description. */
  personLabel: string;
  /** Where staff see their shifts. */
  url?: string | null;
  now?: Date;
}

/**
 * The person's shifts as an iCalendar file (METHOD:PUBLISH). Timed shifts are
 * written in UTC; one that ends at or before it starts ends the next day.
 */
export function buildShiftCalendar(shifts: SentShift[], options: CalendarOptions): string {
  const stamp = utcStamp(options.now ?? new Date());
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//LA-ERP//Shift Planning//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(options.calendarName)}`,
    `X-WR-TIMEZONE:${options.timeZone}`,
  ];
  for (const shift of [...shifts].sort((a, b) => a.date.localeCompare(b.date))) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:shift-${options.uidPrefix}-${shift.date}@${options.uidDomain}`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`SEQUENCE:${shift.seq}`);
    if (shift.start && shift.end) {
      const endDate = minutesOf(shift.end) <= minutesOf(shift.start) ? addDays(shift.date, 1) : shift.date;
      lines.push(`DTSTART:${utcStamp(zonedToUtc(shift.date, shift.start, options.timeZone))}`);
      lines.push(`DTEND:${utcStamp(zonedToUtc(endDate, shift.end, options.timeZone))}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${dateStamp(shift.date)}`);
      lines.push(`DTEND;VALUE=DATE:${dateStamp(addDays(shift.date, 1))}`);
      lines.push('TRANSP:TRANSPARENT');
    }
    const title = shift.name && shift.name !== shift.code ? `${shift.name} (${shift.code})` : shift.code;
    lines.push(`SUMMARY:${escapeText(shift.cancelled ? `Cancelled: ${title}` : title)}`);
    const time = shift.start && shift.end ? `${shift.start}–${shift.end}` : 'All day';
    const description = [`${options.personLabel}: ${title}, ${time}.`, options.url ? `Your shifts: ${options.url}` : null].filter(Boolean).join('\n');
    lines.push(`DESCRIPTION:${escapeText(description)}`);
    if (options.url) lines.push(`URL:${options.url}`);
    lines.push(`STATUS:${shift.cancelled ? 'CANCELLED' : 'CONFIRMED'}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
