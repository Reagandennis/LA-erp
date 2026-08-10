'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';

// --- Inline icons (no external icon dependency) ---
type IconProps = { className?: string };
const svgBase = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  viewBox: '0 0 24 24',
};
const Filter = ({ className }: IconProps) => (
  <svg className={className} {...svgBase}><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" /></svg>
);
const ChevronDown = ({ className }: IconProps) => (
  <svg className={className} {...svgBase}><path d="M6 9l6 6 6-6" /></svg>
);
const Printer = ({ className }: IconProps) => (
  <svg className={className} {...svgBase}><path d="M6 9V2h12v7" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></svg>
);
const Download = ({ className }: IconProps) => (
  <svg className={className} {...svgBase}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></svg>
);
const LinkIcon = ({ className }: IconProps) => (
  <svg className={className} {...svgBase}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
);
const FileSpreadsheet = ({ className }: IconProps) => (
  <svg className={className} {...svgBase}><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" /><path d="M14 2v5h5" /><path d="M8 13h8M8 17h8M11 9v12" /></svg>
);
const Database = ({ className }: IconProps) => (
  <svg className={className} {...svgBase}><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v14a9 3 0 0 0 18 0V5" /><path d="M3 12a9 3 0 0 0 18 0" /></svg>
);
const CheckCircle2 = ({ className }: IconProps) => (
  <svg className={className} {...svgBase}><circle cx="12" cy="12" r="10" /><path d="M9 12l2 2 4-4" /></svg>
);
const XIcon = ({ className }: IconProps) => (
  <svg className={className} {...svgBase}><path d="M18 6 6 18M6 6l12 12" /></svg>
);
const ClockIcon = ({ className }: IconProps) => (
  <svg className={className} {...svgBase}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
);
const PinIcon = ({ className }: IconProps) => (
  <svg className={className} {...svgBase}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
);
const PlusIcon = ({ className }: IconProps) => (
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

export type Shift = ShiftBlock & { id: number };

type RosterState = Record<string, Record<string, Shift[]>>;

type ApiEmployee = { id: number; name: string; position: string };

type ApiShiftBlock = {
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

const PRESETS: Array<{ key: string; label: string; start: string; end: string }> = [
  { key: 'morning', label: 'Morning', start: '08:00', end: '13:00' },
  { key: 'day', label: 'Day', start: '13:00', end: '19:00' },
  { key: 'evening', label: 'Evening', start: '17:00', end: '22:00' },
  { key: 'night', label: 'Night', start: '19:00', end: '01:00' },
];

// Day-timeline window (hours). Bars are clamped to this range.
const DAY_START_HOUR = 6;
const DAY_END_HOUR = 24;
const DAY_RANGE_MIN = (DAY_END_HOUR - DAY_START_HOUR) * 60;

// --- Helpers ---
const getStartOfWeek = (date: Date) => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(12, 0, 0, 0);
  return d;
};

const generateDates = (startDate: Date, count: number) => {
  const dates = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    dates.push(d);
  }
  return dates;
};

const formatDateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const timeToMinutes = (t?: string | null) => {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
};

const calculateHours = (start?: string, end?: string) => {
  const s = timeToMinutes(start);
  const e = timeToMinutes(end);
  if (s == null || e == null) return 0;
  let mins = e - s;
  if (mins < 0) mins += 24 * 60; // overnight shift
  return mins / 60;
};

const formatClock = (t?: string) => {
  if (!t) return '';
  const [hStr, mStr] = t.split(':');
  let h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12;
  if (h === 0) h = 12;
  return m ? `${h}:${String(m).padStart(2, '0')}${ampm}` : `${h}${ampm}`;
};

const formatHours = (h: number) => {
  if (!h) return '0h';
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  return mins ? `${whole}h ${mins}m` : `${whole}h`;
};

const initials = (name: string): string => {
  const s = name.trim();
  if (!s) return '#';
  const parts = s.split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || s[0].toUpperCase();
};

/** Position of a timed shift within the day-timeline window, or null if it doesn't overlap. */
function barGeometry(start?: string | null, end?: string | null): { left: number; width: number } | null {
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

const getShiftStyle = (block: ShiftBlock) => {
  if (block.type === 'available') return 'bg-slate-50 text-slate-500 border border-slate-200';
  if (block.type === 'vacation') return 'bg-red-50 text-red-500 border border-red-200';
  if (block.type === 'preference') return 'bg-teal-50 text-teal-600 border border-teal-200';
  const sh = block.startTime ? parseInt(block.startTime.split(':')[0], 10) : 9;
  if (sh >= 17 || sh < 5) return 'bg-[#bfe1ff] text-slate-800 border border-[#9cccf5]'; // night
  if (sh >= 12) return 'bg-[#fff0b3] text-slate-800 border border-[#ecd97a]'; // afternoon
  return 'bg-[#d8b8ff] text-slate-800 border border-[#c39bf0]'; // morning
};

// --- Component ---
export function ScheduleTab({ readOnly = false }: { readOnly?: boolean } = {}) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(true);
  const [viewMode, setViewMode] = useState<'grid' | 'day'>('grid');
  const [viewDays, setViewDays] = useState<7 | 14 | 28>(7);
  const [startDateStr, setStartDateStr] = useState(() => formatDateKey(getStartOfWeek(new Date())));
  const [positionFilter, setPositionFilter] = useState<Position>('All');
  const [roster, setRoster] = useState<RosterState>({});
  const [activeCell, setActiveCell] = useState<{ empId: string; dateKey: string; shiftId?: number } | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  // Assign-shift modal working state
  const [customStart, setCustomStart] = useState('09:00');
  const [customEnd, setCustomEnd] = useState('17:00');
  const [prefNote, setPrefNote] = useState('');
  const [roleInput, setRoleInput] = useState('');
  const [locationInput, setLocationInput] = useState('');

  // Fetch schedulable employees (works for non-admins too).
  useEffect(() => {
    fetch('/api/clock-in-out/employees', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : { employees: [] }))
      .then((data) => {
        const list: ApiEmployee[] = data.employees || [];
        setEmployees(
          list.map((u) => ({
            id: String(u.id),
            name: u.name,
            position: (u.position as Position) || 'General Sales',
          })),
        );
      })
      .catch(() => {
        // ignore — grid renders its empty state
      })
      .finally(() => setLoadingEmployees(false));
  }, []);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (!(e.target as Element).closest('.export-menu')) {
        setExportMenuOpen(false);
      }
    };
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  // Close the modal on Escape.
  useEffect(() => {
    if (!activeCell) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveCell(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeCell]);

  // The visible date span: a single day in timeline mode, else the grid span.
  const dates = useMemo(() => {
    const startDate = new Date(startDateStr + 'T12:00:00');
    return generateDates(startDate, viewMode === 'day' ? 1 : viewDays);
  }, [startDateStr, viewDays, viewMode]);

  // Load the shared roster for the visible range, and poll so edits by others show up.
  const loadRoster = useCallback(async () => {
    if (dates.length === 0) return;
    const from = formatDateKey(dates[0]);
    const to = formatDateKey(dates[dates.length - 1]);
    try {
      const res = await fetch(`/api/clock-in-out/schedule?from=${from}&to=${to}`, { credentials: 'include' });
      if (!res.ok) return;
      const data = (await res.json()) as {
        shifts?: Array<{ id: number; employeeId: number; date: string; block: ApiShiftBlock }>;
      };
      const next: RosterState = {};
      for (const s of data.shifts ?? []) {
        const key = String(s.employeeId);
        if (!next[key]) next[key] = {};
        if (!next[key][s.date]) next[key][s.date] = [];
        next[key][s.date].push({
          id: s.id,
          type: s.block.type,
          startTime: s.block.startTime ?? undefined,
          endTime: s.block.endTime ?? undefined,
          timeLabel: s.block.timeLabel ?? undefined,
          statusLabel: s.block.statusLabel ?? undefined,
          role: s.block.role ?? undefined,
          location: s.block.location ?? undefined,
          breakMinutes: s.block.breakMinutes ?? undefined,
          note: s.block.note ?? undefined,
          tasksCompleted: s.block.tasksCompleted ?? undefined,
          totalTasks: s.block.totalTasks ?? undefined,
        });
      }
      setRoster(next);
    } catch {
      // ignore
    }
  }, [dates]);

  useEffect(() => {
    // loadRoster fetches, then setState after the await — not a synchronous
    // effect update, so this rule is a false positive here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRoster();
    const id = setInterval(() => void loadRoster(), 20000);
    return () => clearInterval(id);
  }, [loadRoster]);

  const filteredEmployees = useMemo(() => {
    if (positionFilter === 'All') return employees;
    return employees.filter((e) => e.position === positionFilter);
  }, [employees, positionFilter]);

  const shiftsAt = useCallback(
    (empId: string, dateKey: string): Shift[] => roster[empId]?.[dateKey] ?? [],
    [roster],
  );

  const openNew = (empId: string, dateKey: string) => {
    if (readOnly) return;
    setCustomStart('09:00');
    setCustomEnd('17:00');
    setPrefNote('');
    setRoleInput('');
    setLocationInput('');
    setActiveCell({ empId, dateKey });
  };

  const openEdit = (empId: string, dateKey: string, shift: Shift) => {
    if (readOnly) return;
    setCustomStart(shift.startTime ?? '09:00');
    setCustomEnd(shift.endTime ?? '17:00');
    setPrefNote(shift.note ?? '');
    setRoleInput(shift.role ?? '');
    setLocationInput(shift.location ?? '');
    setActiveCell({ empId, dateKey, shiftId: shift.id });
  };

  const applyBlock = (partial: ShiftBlock) => {
    if (!activeCell) return;
    const { empId, dateKey, shiftId } = activeCell;
    const block: ShiftBlock = {
      ...partial,
      role: roleInput.trim() || undefined,
      location: locationInput.trim() || undefined,
    };
    setActiveCell(null);
    void (async () => {
      try {
        if (shiftId != null) {
          await fetch('/api/clock-in-out/schedule', {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: shiftId, block }),
          });
        } else {
          await fetch('/api/clock-in-out/schedule', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ employeeId: Number(empId), date: dateKey, block }),
          });
        }
      } catch {
        // the 20s poll reconciles if this fails
      }
      await loadRoster();
    })();
  };

  const removeShift = (shiftId: number) => {
    setActiveCell(null);
    void (async () => {
      try {
        await fetch('/api/clock-in-out/schedule', {
          method: 'DELETE',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: shiftId }),
        });
      } catch {
        // ignore
      }
      await loadRoster();
    })();
  };

  const editingEmp = activeCell ? employees.find((e) => e.id === activeCell.empId) : null;
  const editingDate = activeCell ? new Date(activeCell.dateKey + 'T12:00:00') : null;
  const customHours = calculateHours(customStart, customEnd);

  const dayHours = useMemo(() => {
    const out: number[] = [];
    for (let h = DAY_START_HOUR; h <= DAY_END_HOUR; h += 2) out.push(h);
    return out;
  }, []);

  return (
    <div className="space-y-6">
      {/* Top Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between rounded-2xl border border-gray-200 bg-white p-4 shadow-sm gap-4 print:hidden">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold text-gray-900">Schedule</h2>
          <div className="h-6 w-px bg-gray-200 mx-2" />
          <div className="relative flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-400" />
            <select
              value={positionFilter}
              onChange={(e) => setPositionFilter(e.target.value as Position)}
              className="text-sm font-medium text-gray-700 bg-transparent focus:outline-none cursor-pointer"
            >
              <option value="All">All Positions</option>
              <option value="General Sales">General Sales</option>
              <option value="Commission Sales">Commission Sales</option>
              <option value="Supervisor">Supervisor</option>
              <option value="Manager">Manager</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-lg bg-gray-100 p-1">
            {(['grid', 'day'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                  viewMode === mode ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                {mode === 'grid' ? 'Grid' : 'Day timeline'}
              </button>
            ))}
          </div>

          {viewMode === 'grid' && (
            <div className="flex rounded-lg bg-gray-100 p-1">
              {[7, 14, 28].map((days) => (
                <button
                  key={days}
                  onClick={() => setViewDays(days as 7 | 14 | 28)}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                    viewDays === days ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-gray-900'
                  }`}
                >
                  {days} Days
                </button>
              ))}
            </div>
          )}

          <input
            type="date"
            value={startDateStr}
            onChange={(e) => {
              const d = new Date(e.target.value + 'T12:00:00');
              if (!isNaN(d.getTime())) {
                setStartDateStr(viewMode === 'day' ? formatDateKey(d) : formatDateKey(getStartOfWeek(d)));
              }
            }}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />

          <div className="relative export-menu">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setExportMenuOpen(!exportMenuOpen);
              }}
              className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
            >
              Export
              <ChevronDown className="w-4 h-4 text-gray-400" />
            </button>

            {exportMenuOpen && (
              <div className="absolute right-0 top-full mt-2 w-48 rounded-xl border border-gray-100 bg-white shadow-xl z-50 py-2">
                <button onClick={() => window.print()} className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-emerald-50 hover:text-emerald-700">
                  <Printer className="w-4 h-4" /> Print
                </button>
                <button onClick={() => alert('PDF Export simulated')} className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-emerald-50 hover:text-emerald-700">
                  <Download className="w-4 h-4" /> Save as PDF
                </button>
                <button onClick={() => alert('Link copied to clipboard')} className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-emerald-50 hover:text-emerald-700">
                  <LinkIcon className="w-4 h-4" /> Send as Link
                </button>
                <button onClick={() => alert('Google Sheets integration simulated')} className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-emerald-50 hover:text-emerald-700">
                  <FileSpreadsheet className="w-4 h-4" /> Google Sheets
                </button>
                <button onClick={() => alert('Google Drive integration simulated')} className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-emerald-50 hover:text-emerald-700">
                  <Database className="w-4 h-4" /> Save to Drive
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Grid view (person × day) ── */}
      {viewMode === 'grid' && (
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden flex flex-col">
          <div className="overflow-x-auto custom-scrollbar relative">
            <table className="w-full border-collapse text-sm text-left whitespace-nowrap min-w-max">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="p-4 bg-white sticky left-0 z-20 w-[200px] min-w-[200px] border-r border-gray-100 shadow-[1px_0_0_0_#f3f4f6]">
                    <div className="flex items-center gap-2 text-gray-500 font-medium">Employee</div>
                  </th>

                  {dates.map((d, i) => {
                    const isToday = formatDateKey(d) === formatDateKey(new Date());
                    return (
                      <th key={i} className="p-4 min-w-[150px] text-center relative font-medium">
                        <div className={`inline-flex items-center justify-center gap-1 ${isToday ? 'bg-emerald-600 text-white px-3 py-1 rounded-full shadow-sm' : 'text-gray-500'}`}>
                          <span>{d.toLocaleDateString('en-US', { weekday: 'short' })}</span>
                          <span>{d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}</span>
                        </div>
                      </th>
                    );
                  })}
                  <th className="p-4 bg-gray-50 text-gray-500 font-medium text-center border-l border-gray-100">Total Hours</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-100">
                {filteredEmployees.map((emp) => {
                  let totalRowHours = 0;

                  return (
                    <tr key={emp.id} className="hover:bg-slate-50/30 transition-colors">
                      <td className="p-4 bg-white sticky left-0 z-10 border-r border-gray-100 shadow-[1px_0_0_0_#f3f4f6] align-top">
                        <div className="flex items-center gap-3">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-700">
                            {initials(emp.name)}
                          </span>
                          <div>
                            <div className="font-semibold text-gray-900">{emp.name}</div>
                            <div className="text-xs text-gray-400">{emp.position}</div>
                          </div>
                        </div>
                      </td>

                      {dates.map((d, i) => {
                        const dateKey = formatDateKey(d);
                        const shifts = shiftsAt(emp.id, dateKey);
                        for (const s of shifts) totalRowHours += calculateHours(s.startTime, s.endTime);

                        return (
                          <td key={`cell-${i}`} className="p-2 align-top min-w-[150px]">
                            <div className="flex flex-col gap-1.5">
                              {shifts.map((s) => {
                                const hrs = calculateHours(s.startTime, s.endTime);
                                return (
                                  <button
                                    key={s.id}
                                    type="button"
                                    onClick={() => openEdit(emp.id, dateKey, s)}
                                    disabled={readOnly}
                                    className={`w-full rounded-xl p-2.5 flex flex-col gap-1 text-left transition-all ${getShiftStyle(s)} ${
                                      readOnly ? 'cursor-default' : 'cursor-pointer hover:-translate-y-0.5 hover:shadow-md'
                                    }`}
                                  >
                                    <div className="font-semibold text-[13px] leading-tight whitespace-pre-wrap">
                                      {s.timeLabel || s.statusLabel || 'Shift'}
                                    </div>
                                    {(s.role || s.location) && (
                                      <div className="flex items-center gap-1 text-[10px] font-medium opacity-70">
                                        {s.role && <span>{s.role}</span>}
                                        {s.location && (
                                          <span className="inline-flex items-center gap-0.5">
                                            <PinIcon className="w-2.5 h-2.5" />
                                            {s.location}
                                          </span>
                                        )}
                                      </div>
                                    )}
                                    {hrs > 0 ? (
                                      <div className="flex items-center gap-1 text-[10px] font-semibold opacity-75">
                                        <ClockIcon className="w-3 h-3" /> {formatHours(hrs)}
                                        {s.breakMinutes ? <span className="opacity-70">· {s.breakMinutes}m break</span> : null}
                                      </div>
                                    ) : s.totalTasks !== undefined ? (
                                      <div className="flex items-center gap-1 text-[10px] font-medium opacity-70">
                                        <span className="flex h-3 w-3 items-center justify-center rounded-full border border-current border-opacity-50">
                                          {s.tasksCompleted === s.totalTasks && s.totalTasks > 0 ? <CheckCircle2 className="w-2 h-2" /> : null}
                                        </span>
                                        {s.tasksCompleted}/{s.totalTasks} tasks
                                      </div>
                                    ) : null}
                                  </button>
                                );
                              })}

                              {!readOnly && (
                                <button
                                  type="button"
                                  onClick={() => openNew(emp.id, dateKey)}
                                  className={`flex items-center justify-center gap-1 rounded-xl border border-dashed border-gray-200 py-1.5 text-[11px] font-medium text-gray-400 transition-colors hover:border-emerald-300 hover:bg-emerald-50/40 hover:text-emerald-600 ${
                                    shifts.length === 0 ? 'h-16' : ''
                                  }`}
                                >
                                  <PlusIcon className="w-3.5 h-3.5" /> {shifts.length === 0 ? 'Add shift' : 'Add'}
                                </button>
                              )}
                              {readOnly && shifts.length === 0 && <div className="h-16" />}
                            </div>
                          </td>
                        );
                      })}

                      <td className="p-4 bg-gray-50 border-l border-gray-100 text-center align-middle">
                        <div className="font-bold text-gray-900 text-lg">{totalRowHours > 0 ? formatHours(totalRowHours) : '-'}</div>
                        <div className="text-xs text-gray-400 mt-1">Total Time</div>
                      </td>
                    </tr>
                  );
                })}

                {filteredEmployees.length === 0 && (
                  <tr>
                    <td colSpan={dates.length + 2} className="p-10 text-center text-sm text-gray-400">
                      {loadingEmployees ? 'Loading employees…' : 'No employees on the schedule yet. Add the “clock-in-out” module to a user to include them.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Day timeline view (person × hours) ── */}
      {viewMode === 'day' && (
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="border-b border-gray-100 px-4 py-3">
            <p className="text-sm font-semibold text-gray-900">
              {dates[0]?.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
            <p className="text-xs text-gray-400">Each bar is a shift; overlaps and gaps show coverage across the day.</p>
          </div>
          <div className="overflow-x-auto custom-scrollbar">
            <div className="min-w-[760px]">
              {/* Hour ruler */}
              <div className="flex border-b border-gray-100 bg-gray-50/60">
                <div className="w-[180px] shrink-0 border-r border-gray-100 px-4 py-2 text-xs font-medium text-gray-400">
                  Employee
                </div>
                <div className="relative flex-1 h-8">
                  {dayHours.map((h) => (
                    <div
                      key={h}
                      className="absolute top-0 bottom-0 border-l border-gray-100 pl-1 text-[10px] text-gray-400"
                      style={{ left: `${((h - DAY_START_HOUR) / (DAY_END_HOUR - DAY_START_HOUR)) * 100}%` }}
                    >
                      {formatClock(`${String(h % 24).padStart(2, '0')}:00`)}
                    </div>
                  ))}
                </div>
              </div>

              {/* One track per employee */}
              {filteredEmployees.map((emp) => {
                const dateKey = dates[0] ? formatDateKey(dates[0]) : '';
                const shifts = shiftsAt(emp.id, dateKey);
                const timed = shifts.filter((s) => barGeometry(s.startTime, s.endTime));
                const untimed = shifts.filter((s) => !barGeometry(s.startTime, s.endTime));
                return (
                  <div key={emp.id} className="flex border-b border-gray-50 last:border-b-0 hover:bg-slate-50/30">
                    <div className="w-[180px] shrink-0 border-r border-gray-100 px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-semibold text-emerald-700">
                          {initials(emp.name)}
                        </span>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-gray-900">{emp.name}</div>
                          <div className="truncate text-[10px] text-gray-400">{emp.position}</div>
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => openNew(emp.id, dateKey)}
                      disabled={readOnly}
                      className={`relative flex-1 min-h-[64px] ${readOnly ? 'cursor-default' : 'cursor-copy'}`}
                      title={readOnly ? undefined : 'Click to add a shift'}
                    >
                      {/* hour gridlines */}
                      {dayHours.map((h) => (
                        <span
                          key={h}
                          className="absolute top-0 bottom-0 border-l border-gray-50"
                          style={{ left: `${((h - DAY_START_HOUR) / (DAY_END_HOUR - DAY_START_HOUR)) * 100}%` }}
                        />
                      ))}
                      {/* full-width bands for day-off / availability blocks */}
                      {untimed.map((s, idx) => (
                        <span
                          key={s.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            openEdit(emp.id, dateKey, s);
                          }}
                          className={`absolute inset-x-2 flex items-center rounded-lg px-2 text-[11px] font-semibold ${getShiftStyle(s)}`}
                          style={{ top: `${8 + idx * 22}px`, height: '18px' }}
                        >
                          {s.statusLabel?.replace(/\n/g, ' ') || 'Off'}
                        </span>
                      ))}
                      {/* timed shift bars */}
                      {timed.map((s) => {
                        const geo = barGeometry(s.startTime, s.endTime)!;
                        return (
                          <span
                            key={s.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              openEdit(emp.id, dateKey, s);
                            }}
                            className={`absolute top-2 bottom-2 flex flex-col justify-center overflow-hidden rounded-lg px-2 text-[11px] shadow-sm ${getShiftStyle(s)}`}
                            style={{ left: `${geo.left}%`, width: `${geo.width}%`, minWidth: '44px' }}
                          >
                            <span className="truncate font-semibold leading-tight">
                              {s.timeLabel || `${formatClock(s.startTime)}–${formatClock(s.endTime)}`}
                            </span>
                            {(s.role || s.location) && (
                              <span className="truncate text-[10px] opacity-70">
                                {[s.role, s.location].filter(Boolean).join(' · ')}
                              </span>
                            )}
                          </span>
                        );
                      })}
                    </button>
                  </div>
                );
              })}

              {filteredEmployees.length === 0 && (
                <div className="p-10 text-center text-sm text-gray-400">
                  {loadingEmployees ? 'Loading employees…' : 'No employees on the schedule yet.'}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Assign / edit Shift modal */}
      {!readOnly && activeCell && editingEmp && editingDate && (
        <>
          <button type="button" aria-label="Close" className="fixed inset-0 z-[300] bg-slate-900/30 backdrop-blur-sm" onClick={() => setActiveCell(null)} />
          <div className="fixed left-1/2 top-1/2 z-[310] w-full max-w-md -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <div>
                <h3 className="text-base font-bold text-gray-900">{activeCell.shiftId != null ? 'Edit shift' : 'Add shift'}</h3>
                <p className="text-xs text-gray-500">
                  {editingEmp.name} · {editingDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                </p>
              </div>
              <button onClick={() => setActiveCell(null)} className="rounded-lg bg-gray-50 p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                <XIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-[70vh] space-y-5 overflow-y-auto px-6 py-5">
              {/* Role + location */}
              <div className="grid grid-cols-2 gap-2">
                <label>
                  <span className="mb-1 block text-[11px] font-medium text-gray-500">Role (optional)</span>
                  <input type="text" value={roleInput} onChange={(e) => setRoleInput(e.target.value)} placeholder="e.g. Supervisor" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                </label>
                <label>
                  <span className="mb-1 block text-[11px] font-medium text-gray-500">Location (optional)</span>
                  <input type="text" value={locationInput} onChange={(e) => setLocationInput(e.target.value)} placeholder="e.g. Front desk" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                </label>
              </div>

              {/* Quick presets */}
              <div>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-gray-400">Quick shifts</p>
                <div className="grid grid-cols-2 gap-2">
                  {PRESETS.map((p) => (
                    <button
                      key={p.key}
                      onClick={() => applyBlock({ type: 'work-day', startTime: p.start, endTime: p.end, timeLabel: `${formatClock(p.start)}–${formatClock(p.end)}` })}
                      className="flex flex-col items-start rounded-xl border border-gray-200 px-3 py-2 text-left transition-colors hover:border-emerald-300 hover:bg-emerald-50/40"
                    >
                      <span className="text-sm font-semibold text-gray-900">{p.label}</span>
                      <span className="text-[11px] text-gray-500">{formatClock(p.start)}–{formatClock(p.end)} · {formatHours(calculateHours(p.start, p.end))}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom time */}
              <div>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-gray-400">Custom shift</p>
                <div className="flex items-end gap-2">
                  <label className="flex-1">
                    <span className="mb-1 block text-[11px] font-medium text-gray-500">Start</span>
                    <input type="time" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                  </label>
                  <label className="flex-1">
                    <span className="mb-1 block text-[11px] font-medium text-gray-500">End</span>
                    <input type="time" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                  </label>
                  <button
                    onClick={() => applyBlock({ type: 'work-day', startTime: customStart, endTime: customEnd, timeLabel: `${formatClock(customStart)}–${formatClock(customEnd)}` })}
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                  >
                    {activeCell.shiftId != null ? 'Save' : 'Add'}
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] text-gray-400">Duration: {formatHours(customHours)}{customHours === 0 ? ' (set an end after the start)' : ''}</p>
              </div>

              {/* Status / availability */}
              <div>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-gray-400">Status</p>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => applyBlock({ type: 'available', statusLabel: 'Available' })} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-slate-600 hover:border-slate-300 hover:bg-slate-50">Available</button>
                  <button onClick={() => applyBlock({ type: 'vacation', statusLabel: 'Unavailable\nVacation' })} className="rounded-xl border border-red-200 bg-red-50/40 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50">Vacation</button>
                </div>
                <div className="mt-2 flex items-end gap-2">
                  <label className="flex-1">
                    <span className="mb-1 block text-[11px] font-medium text-gray-500">Preference note (optional)</span>
                    <input type="text" value={prefNote} onChange={(e) => setPrefNote(e.target.value)} placeholder="e.g. Prefers mornings" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                  </label>
                  <button
                    onClick={() => applyBlock({ type: 'preference', statusLabel: prefNote ? `Prefers:\n${prefNote}` : 'Preferred', note: prefNote })}
                    className="rounded-lg border border-teal-200 bg-teal-50 px-4 py-2 text-sm font-semibold text-teal-700 hover:bg-teal-100"
                  >
                    Set
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-gray-100 px-6 py-3">
              <button
                onClick={() => activeCell.shiftId != null && removeShift(activeCell.shiftId)}
                disabled={activeCell.shiftId == null}
                className="text-sm font-semibold text-rose-500 hover:text-rose-700 disabled:opacity-40"
              >
                Delete shift
              </button>
              <button onClick={() => setActiveCell(null)} className="rounded-lg px-4 py-2 text-sm font-semibold text-gray-500 hover:text-gray-700">Close</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
