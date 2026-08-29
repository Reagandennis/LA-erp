'use client';

/**
 * Shared vocabulary for the shift-planning views.
 *
 * Dates are 'YYYY-MM-DD' keys everywhere, matching the API, so nothing here
 * needs a timezone. Date objects are only ever used for arithmetic and are
 * normalised to midday so a DST shift can't roll one over a day boundary.
 */

export interface Person {
  id: number;
  name: string;
  email: string;
  position: string;
  teamIds: string[];
}

export interface Team {
  id: string;
  name: string;
  colour: string;
  members: Array<{ userId: number; name: string; email: string }>;
}

export interface TemplatePerson {
  userId: number;
  name: string;
  email: string;
  hours: number | null;
}

export interface ShiftTemplate {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  weekdays: number[];
  colour: string;
  active: boolean;
  sortOrder: number;
  spanHours: number;
  members: TemplatePerson[];
  teams: Array<{ teamId: string; name: string; colour: string; memberCount: number; hours: number | null }>;
}

export interface ShiftBlock {
  type: string;
  startTime?: string | null;
  endTime?: string | null;
  timeLabel?: string | null;
  statusLabel?: string | null;
  role?: string | null;
  location?: string | null;
  breakMinutes?: number | null;
  note?: string | null;
}

export interface Shift {
  id: number;
  employeeId: number;
  date: string;
  /** The pattern this shift came from; drives its colour on the board. */
  templateId: string | null;
  block: ShiftBlock;
}

export type LeaveType = 'annual' | 'sick' | 'casual' | 'unpaid';
export type LeaveStatus = 'pending' | 'approved' | 'declined';

export interface Leave {
  id: string;
  userId: number;
  userName: string;
  type: LeaveType;
  startDate: string;
  endDate: string;
  status: LeaveStatus;
  note: string | null;
  decidedByName: string | null;
}

export interface Holiday {
  id: string;
  date: string;
  name: string;
}

// --- Dates -----------------------------------------------------------------

// These live in lib/date-grid.ts so the Gantt can share them without pulling
// this module's React components in. Re-exported here to keep existing
// imports (and tests/shift-planning-dates.test.ts) working unchanged.
export {
  atNoon,
  dateKey,
  addDays,
  startOfWeek,
  startOfMonth,
  isoWeekday,
  rangeOfDays,
  monthGrid,
  isSameDay,
} from '@/lib/date-grid';

export function formatDayName(date: Date): string {
  return date.toLocaleDateString(undefined, { weekday: 'long' });
}

export function formatShortDay(date: Date): string {
  return date.toLocaleDateString(undefined, { weekday: 'short' });
}

export function formatRange(days: Date[]): string {
  if (days.length === 0) return '';
  const first = days[0]!;
  const last = days[days.length - 1]!;
  const sameMonth = first.getMonth() === last.getMonth();
  const firstPart = first.toLocaleDateString(undefined, {
    day: 'numeric',
    ...(sameMonth ? {} : { month: 'short' }),
  });
  const lastPart = last.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return `${firstPart}–${lastPart}`;
}

/** Whole days a leave request covers, inclusive of both ends. */
export function leaveCoversDate(leave: Leave, key: string): boolean {
  return leave.startDate <= key && key <= leave.endDate;
}

export function hoursBetween(startTime?: string | null, endTime?: string | null): number | null {
  if (!startTime || !endTime) return null;
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  if ([sh, sm, eh, em].some((n) => !Number.isFinite(n))) return null;
  const start = sh! * 60 + sm!;
  let end = eh! * 60 + em!;
  // An overnight shift legitimately ends before it starts.
  if (end <= start) end += 24 * 60;
  return Math.round(((end - start) / 60) * 10) / 10;
}

export function formatHours(hours: number | null): string {
  if (hours === null) return '';
  return Number.isInteger(hours) ? `${hours} hr` : `${hours.toFixed(1)} hr`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
}

// --- Palette ---------------------------------------------------------------

/**
 * Colour keys are stored, never raw CSS — so a palette change is one edit here
 * rather than a migration.
 */
export const COLOUR_CLASSES: Record<string, { chip: string; dot: string; bar: string; soft: string }> = {
  blue: { chip: 'bg-blue-50 text-blue-700', dot: 'bg-blue-500', bar: 'border-l-blue-400', soft: 'bg-blue-50' },
  emerald: {
    chip: 'bg-emerald-50 text-emerald-700',
    dot: 'bg-emerald-500',
    bar: 'border-l-emerald-400',
    soft: 'bg-emerald-50',
  },
  amber: { chip: 'bg-amber-50 text-amber-700', dot: 'bg-amber-500', bar: 'border-l-amber-400', soft: 'bg-amber-50' },
  violet: {
    chip: 'bg-violet-50 text-violet-700',
    dot: 'bg-violet-500',
    bar: 'border-l-violet-400',
    soft: 'bg-violet-50',
  },
  rose: { chip: 'bg-rose-50 text-rose-700', dot: 'bg-rose-500', bar: 'border-l-rose-400', soft: 'bg-rose-50' },
  slate: { chip: 'bg-slate-100 text-slate-700', dot: 'bg-slate-400', bar: 'border-l-slate-300', soft: 'bg-slate-50' },
};

export function colourOf(key: string) {
  return COLOUR_CLASSES[key] ?? COLOUR_CLASSES.slate!;
}

export const LEAVE_COLOURS: Record<LeaveType, { label: string; dot: string; chip: string }> = {
  annual: { label: 'Annual', dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700' },
  sick: { label: 'Sick', dot: 'bg-violet-500', chip: 'bg-violet-50 text-violet-700' },
  casual: { label: 'Casual', dot: 'bg-blue-500', chip: 'bg-blue-50 text-blue-700' },
  unpaid: { label: 'Unpaid', dot: 'bg-slate-400', chip: 'bg-slate-100 text-slate-700' },
};

export const inputClass =
  'w-full rounded-xl bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30';

// --- Small shared pieces ---------------------------------------------------

export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  const dim = size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-8 w-8 text-xs';
  return (
    <span
      className={`inline-flex ${dim} shrink-0 items-center justify-center rounded-full bg-primary/10 font-bold text-primary`}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
