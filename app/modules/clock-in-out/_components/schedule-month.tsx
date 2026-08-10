'use client';

import { useMemo } from 'react';

import {
  formatDateKey,
  generateDates,
  getShiftStyle,
  getStartOfWeek,
  initials,
  type Employee,
  type RosterState,
  type Shift,
} from './schedule-shared';

type Props = {
  employees: Employee[];
  roster: RosterState;
  monthAnchor: Date;
  readOnly: boolean;
  loadingEmployees: boolean;
  onAddDay: (dateKey: string) => void;
  onEdit: (shift: Shift) => void;
  onOpenDay: (date: Date) => void;
};

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MAX_PILLS = 3;

const pillLabel = (s: Shift) => s.timeLabel || s.statusLabel?.replace(/\n/g, ' ') || 'Shift';

export function ScheduleMonth({ employees, roster, monthAnchor, readOnly, loadingEmployees, onAddDay, onEdit, onOpenDay }: Props) {
  const empName = useMemo(() => new Map(employees.map((e) => [e.id, e.name])), [employees]);

  // 6-week grid (Mon-first) covering the anchor month.
  const cells = useMemo(() => {
    const first = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), 1, 12, 0, 0, 0);
    return generateDates(getStartOfWeek(first), 42);
  }, [monthAnchor]);

  // All shifts for the visible span, keyed by date, limited to the filtered employees.
  const byDate = useMemo(() => {
    const empIds = new Set(employees.map((e) => e.id));
    const map = new Map<string, Shift[]>();
    for (const empId of Object.keys(roster)) {
      if (!empIds.has(empId)) continue;
      for (const dk of Object.keys(roster[empId])) {
        const arr = map.get(dk) ?? [];
        arr.push(...roster[empId][dk]);
        map.set(dk, arr);
      }
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => (a.startTime ?? '99').localeCompare(b.startTime ?? '99'));
    }
    return map;
  }, [roster, employees]);

  const anchorMonth = monthAnchor.getMonth();
  const todayKey = formatDateKey(new Date());

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      {/* Weekday header */}
      <div className="grid grid-cols-7 border-b border-gray-100 bg-gray-50/60">
        {WEEKDAYS.map((w) => (
          <div key={w} className="px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            {w}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7">
        {cells.map((cell, i) => {
          const dateKey = formatDateKey(cell);
          const inMonth = cell.getMonth() === anchorMonth;
          const isToday = dateKey === todayKey;
          const isWeekend = cell.getDay() === 0 || cell.getDay() === 6;
          const shifts = byDate.get(dateKey) ?? [];
          const shown = shifts.slice(0, MAX_PILLS);
          const extra = shifts.length - shown.length;

          return (
            <div
              key={i}
              onClick={() => !readOnly && onAddDay(dateKey)}
              className={`min-h-[116px] border-b border-r border-gray-100 p-1.5 flex flex-col gap-1 transition-colors [&:nth-child(7n)]:border-r-0 ${
                inMonth ? (isWeekend ? 'bg-slate-50/40' : 'bg-white') : 'bg-gray-50/50'
              } ${readOnly ? '' : 'cursor-copy hover:bg-emerald-50/30'}`}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenDay(cell);
                }}
                className={`self-start rounded-full px-1.5 text-xs font-semibold transition-colors ${
                  isToday
                    ? 'bg-emerald-600 text-white'
                    : inMonth
                      ? 'text-gray-700 hover:bg-gray-100'
                      : 'text-gray-300 hover:bg-gray-100'
                }`}
              >
                {cell.getDate()}
              </button>

              <div className="flex flex-col gap-1">
                {shown.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(s);
                    }}
                    disabled={readOnly}
                    className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 text-left text-[11px] leading-tight ${getShiftStyle(s)} ${
                      readOnly ? 'cursor-default' : 'cursor-pointer hover:brightness-95'
                    }`}
                    title={`${empName.get(s.employeeId) ?? ''} · ${pillLabel(s)}${s.role ? ` · ${s.role}` : ''}`}
                  >
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white/60 text-[8px] font-bold">
                      {initials(empName.get(s.employeeId) ?? '?')}
                    </span>
                    <span className="truncate font-semibold">{pillLabel(s)}</span>
                  </button>
                ))}
                {extra > 0 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenDay(cell);
                    }}
                    className="self-start px-1.5 text-[10px] font-semibold text-gray-400 hover:text-emerald-600"
                  >
                    +{extra} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {employees.length === 0 && (
        <div className="p-8 text-center text-sm text-gray-400">
          {loadingEmployees ? 'Loading employees…' : 'No employees on the schedule yet. Add the “clock-in-out” module to a user to include them.'}
        </div>
      )}
    </div>
  );
}
