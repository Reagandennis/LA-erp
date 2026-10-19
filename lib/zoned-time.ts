/**
 * Wall-clock time in a named IANA time zone, without a date library.
 *
 * A flight's times are local to its airport, not to whoever is looking at the
 * itinerary, so the form takes "14:30 in Africa/Nairobi" and we store the UTC
 * instant. Client-safe: only `Intl`.
 */

/** The browser's own zone, or UTC when it can't say. */
export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** The zone's wall-clock parts at `instant`. */
function wallParts(instant: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  };
}

/** How far the zone's clock is ahead of UTC at `instant`, in ms. */
function offsetMs(instant: number, timeZone: string): number {
  const p = wallParts(instant, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - instant;
}

/**
 * "2026-10-20" + "14:30" in `timeZone` → ISO instant. Null for malformed input.
 * Two passes, so a time just across a DST change uses the offset in force then.
 */
export function zonedToUtcIso(date: string, time: string, timeZone: string): string | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t || !isValidTimeZone(timeZone)) return null;
  const wall = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]));
  if (Number.isNaN(wall)) return null;
  let instant = wall - offsetMs(wall, timeZone);
  const corrected = wall - offsetMs(instant, timeZone);
  if (corrected !== instant) instant = corrected;
  return new Date(instant).toISOString();
}

/** An instant as the zone's `{ date: "YYYY-MM-DD", time: "HH:MM" }`. */
export function utcToZoned(iso: string | null, timeZone: string): { date: string; time: string } {
  if (!iso || !isValidTimeZone(timeZone)) return { date: '', time: '' };
  const instant = new Date(iso).getTime();
  if (Number.isNaN(instant)) return { date: '', time: '' };
  const p = wallParts(instant, timeZone);
  const pad = (n: number) => String(n).padStart(2, '0');
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, time: `${pad(p.hour)}:${pad(p.minute)}` };
}

/** "GMT+3", "GMT-4", "GMT" — the zone's offset at `instant`. */
export function offsetLabel(timeZone: string, instant: number = Date.now()): string {
  if (!isValidTimeZone(timeZone)) return '';
  const minutes = Math.round(offsetMs(instant, timeZone) / 60_000);
  if (minutes === 0) return 'GMT';
  const sign = minutes > 0 ? '+' : '-';
  const h = Math.floor(Math.abs(minutes) / 60);
  const m = Math.abs(minutes) % 60;
  return `GMT${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

/** Every zone the runtime knows, falling back to a short list on old engines. */
export function allTimeZones(): string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  try {
    if (supported) return supported('timeZone');
  } catch {
    // fall through
  }
  return ['UTC', 'Africa/Nairobi', 'Africa/Johannesburg', 'Europe/London', 'Asia/Dubai', 'America/New_York'];
}

/** The weekday a calendar date falls on: "Monday". */
export function weekdayOf(date: string, locale?: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  const d = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(locale, { weekday: 'long', timeZone: 'UTC' });
}
