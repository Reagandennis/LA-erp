// Shared types, constants, helpers, and icons for the Schedule views
// (grid, day timeline, month calendar) and the assign-shift modal.

export type IconProps = { className?: string };
const svgBase = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  viewBox: '0 0 24 24',
};
export const Filter = ({ className }: IconProps) => (
  <svg className={className} {...svgBase}><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" /></svg>
);
export const ChevronDown = ({ className }: IconProps) => (
  <svg className={className} {...svgBase}><path d="M6 9l6 6 6-6" /></svg>
);
export const ChevronLeft = ({ className }: IconProps) => (
  <svg className={className} {...svgBase}><path d="M15 18l-6-6 6-6" /></svg>
);
export const ChevronRight = ({ className }: IconProps) => (
  <svg className={className} {...svgBase}><path d="M9 18l6-6-6-6" /></svg>
);
export const Printer = ({ className }: IconProps) => (
  <svg className={className} {...svgBase}><path d="M6 9V2h12v7" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></svg>
);
export const Download = ({ className }: IconProps) => (
  <svg className={className} {...svgBase}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></svg>
);
export const LinkIcon = ({ className }: IconProps) => (
  <svg className={className} {...svgBase}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
);
export const FileSpreadsheet = ({ className }: IconProps) => (
  <svg className={className} {...svgBase}><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" /><path d="M14 2v5h5" /><path d="M8 13h8M8 17h8M11 9v12" /></svg>
);
export const Database = ({ className }: IconProps) => (
  <svg className={className} {...svgBase}><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v14a9 3 0 0 0 18 0V5" /><path d="M3 12a9 3 0 0 0 18 0" /></svg>
);
export const CheckCircle2 = ({ className }: IconProps) => (
  <svg className={className} {...svgBase}><circle cx="12" cy="12" r="10" /><path d="M9 12l2 2 4-4" /></svg>
);
export const XIcon = ({ className }: IconProps) => (
  <svg className={className} {...svgBase}><path d="M18 6 6 18M6 6l12 12" /></svg>
);
export const ClockIcon = ({ className }: IconProps) => (
  <svg className={className} {...svgBase}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
);
export const PinIcon = ({ className }: IconProps) => (
  <svg className={className} {...svgBase}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
);
export const PlusIcon = ({ className }: IconProps) => (
  <svg className={className} {...svgBase}><path d="M12 5v14M5 12h14" /></svg>
);

// --- Types ---
export type Position = 'All' | 'General Sales' | 'Commission Sales' | 'Manager' | 'Supervisor';

export type Employee = {
  id: string;
  name: string;
  position: Position;
};

export type ShiftType = 'work-day' | 'work-night' | 'vacation' | 'preference' | 'available' | 'empty';

export type ShiftBlock = {
  type: ShiftType;
  startTime?: string;
  endTime?: string;
  timeLabel?: string;
  statusLabel?: string;
  role?: string;
  location?: string;
  breakMinutes?: number;
  note?: string;
  tasksCompleted?: number;
  totalTasks?: number;
};

export type Shift = ShiftBlock & { id: number; employeeId: string; date: string };

export type RosterState = Record<string, Record<string, Shift[]>>;

export type ApiShiftBlock = {
  type: ShiftType;
  startTime?: string | null;
  endTime?: string | null;
  timeLabel?: string | null;
  statusLabel?: string | null;
  role?: string | null;
  location?: string | null;
  breakMinutes?: number | null;
  note?: string | null;
  tasksCompleted?: number | null;
  totalTasks?: number | null;
};

export const PRESETS: Array<{ key: string; label: string; start: string; end: string }> = [
  { key: 'morning', label: 'Morning', start: '08:00', end: '13:00' },
  { key: 'day', label: 'Day', start: '13:00', end: '19:00' },
  { key: 'evening', label: 'Evening', start: '17:00', end: '22:00' },
  { key: 'night', label: 'Night', start: '19:00', end: '01:00' },
];

// Day-timeline window (hours). Bars are clamped to this range.
export const DAY_START_HOUR = 6;
export const DAY_END_HOUR = 24;
export const DAY_RANGE_MIN = (DAY_END_HOUR - DAY_START_HOUR) * 60;

// --- Helpers ---
export const getStartOfWeek = (date: Date) => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(12, 0, 0, 0);
  return d;
};

export const generateDates = (startDate: Date, count: number) => {
  const dates: Date[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    dates.push(d);
  }
  return dates;
};

export const formatDateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export const timeToMinutes = (t?: string | null) => {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
};

export const calculateHours = (start?: string, end?: string) => {
  const s = timeToMinutes(start);
  const e = timeToMinutes(end);
  if (s == null || e == null) return 0;
  let mins = e - s;
  if (mins < 0) mins += 24 * 60; // overnight shift
  return mins / 60;
};

export const formatClock = (t?: string) => {
  if (!t) return '';
  const [hStr, mStr] = t.split(':');
  let h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12;
  if (h === 0) h = 12;
  return m ? `${h}:${String(m).padStart(2, '0')}${ampm}` : `${h}${ampm}`;
};

export const formatHours = (h: number) => {
  if (!h) return '0h';
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  return mins ? `${whole}h ${mins}m` : `${whole}h`;
};

export const initials = (name: string): string => {
  const s = name.trim();
  if (!s) return '#';
  const parts = s.split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || s[0].toUpperCase();
};

/** Position of a timed shift within the day-timeline window, or null if it doesn't overlap. */
export function barGeometry(start?: string | null, end?: string | null): { left: number; width: number } | null {
  const s = timeToMinutes(start);
  let e = timeToMinutes(end);
  if (s == null || e == null) return null;
  if (e <= s) e += 24 * 60; // overnight
  const from = Math.max(s, DAY_START_HOUR * 60);
  const to = Math.min(e, DAY_END_HOUR * 60);
  if (to <= from) return null;
  return {
    left: ((from - DAY_START_HOUR * 60) / DAY_RANGE_MIN) * 100,
    width: ((to - from) / DAY_RANGE_MIN) * 100,
  };
}

export const getShiftStyle = (block: ShiftBlock) => {
  if (block.type === 'available') return 'bg-slate-50 text-slate-500 border border-slate-200';
  if (block.type === 'vacation') return 'bg-red-50 text-red-500 border border-red-200';
  if (block.type === 'preference') return 'bg-teal-50 text-teal-600 border border-teal-200';
  const sh = block.startTime ? parseInt(block.startTime.split(':')[0], 10) : 9;
  if (sh >= 17 || sh < 5) return 'bg-[#bfe1ff] text-slate-800 border border-[#9cccf5]'; // night
  if (sh >= 12) return 'bg-[#fff0b3] text-slate-800 border border-[#ecd97a]'; // afternoon
  return 'bg-[#d8b8ff] text-slate-800 border border-[#c39bf0]'; // morning
};
