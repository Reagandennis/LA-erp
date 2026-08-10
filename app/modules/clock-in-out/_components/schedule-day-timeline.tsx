'use client';

import {
  DAY_END_HOUR,
  DAY_START_HOUR,
  barGeometry,
  formatClock,
  formatDateKey,
  getShiftStyle,
  initials,
  type Employee,
  type RosterState,
  type Shift,
} from './schedule-shared';

type Props = {
  employees: Employee[];
  roster: RosterState;
  date: Date;
  readOnly: boolean;
  loadingEmployees: boolean;
  onAdd: (employeeId: string, dateKey: string) => void;
  onEdit: (shift: Shift) => void;
};

const HOURS: number[] = [];
for (let h = DAY_START_HOUR; h <= DAY_END_HOUR; h += 2) HOURS.push(h);

const leftPct = (hour: number) => ((hour - DAY_START_HOUR) / (DAY_END_HOUR - DAY_START_HOUR)) * 100;

export function ScheduleDayTimeline({ employees, roster, date, readOnly, loadingEmployees, onAdd, onEdit }: Props) {
  const dateKey = formatDateKey(date);
  const shiftsAt = (empId: string): Shift[] => roster[empId]?.[dateKey] ?? [];

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="border-b border-gray-100 px-4 py-3">
        <p className="text-sm font-semibold text-gray-900">
          {date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
        <p className="text-xs text-gray-400">Each bar is a shift; overlaps and gaps show coverage across the day.</p>
      </div>
      <div className="overflow-x-auto custom-scrollbar">
        <div className="min-w-[760px]">
          {/* Hour ruler */}
          <div className="flex border-b border-gray-100 bg-gray-50/60">
            <div className="w-[180px] shrink-0 border-r border-gray-100 px-4 py-2 text-xs font-medium text-gray-400">Employee</div>
            <div className="relative flex-1 h-8">
              {HOURS.map((h) => (
                <div key={h} className="absolute top-0 bottom-0 border-l border-gray-100 pl-1 text-[10px] text-gray-400" style={{ left: `${leftPct(h)}%` }}>
                  {formatClock(`${String(h % 24).padStart(2, '0')}:00`)}
                </div>
              ))}
            </div>
          </div>

          {/* One track per employee */}
          {employees.map((emp) => {
            const shifts = shiftsAt(emp.id);
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
                  onClick={() => onAdd(emp.id, dateKey)}
                  disabled={readOnly}
                  className={`relative flex-1 min-h-[64px] ${readOnly ? 'cursor-default' : 'cursor-copy'}`}
                  title={readOnly ? undefined : 'Click to add a shift'}
                >
                  {HOURS.map((h) => (
                    <span key={h} className="absolute top-0 bottom-0 border-l border-gray-50" style={{ left: `${leftPct(h)}%` }} />
                  ))}
                  {untimed.map((s, idx) => (
                    <span
                      key={s.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        onEdit(s);
                      }}
                      className={`absolute inset-x-2 flex items-center rounded-lg px-2 text-[11px] font-semibold ${getShiftStyle(s)}`}
                      style={{ top: `${8 + idx * 22}px`, height: '18px' }}
                    >
                      {s.statusLabel?.replace(/\n/g, ' ') || 'Off'}
                    </span>
                  ))}
                  {timed.map((s) => {
                    const geo = barGeometry(s.startTime, s.endTime)!;
                    return (
                      <span
                        key={s.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          onEdit(s);
                        }}
                        className={`absolute top-2 bottom-2 flex flex-col justify-center overflow-hidden rounded-lg px-2 text-[11px] shadow-sm ${getShiftStyle(s)}`}
                        style={{ left: `${geo.left}%`, width: `${geo.width}%`, minWidth: '44px' }}
                      >
                        <span className="truncate font-semibold leading-tight">
                          {s.timeLabel || `${formatClock(s.startTime)}–${formatClock(s.endTime)}`}
                        </span>
                        {(s.role || s.location) && (
                          <span className="truncate text-[10px] opacity-70">{[s.role, s.location].filter(Boolean).join(' · ')}</span>
                        )}
                      </span>
                    );
                  })}
                </button>
              </div>
            );
          })}

          {employees.length === 0 && (
            <div className="p-10 text-center text-sm text-gray-400">
              {loadingEmployees ? 'Loading employees…' : 'No employees on the schedule yet.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
