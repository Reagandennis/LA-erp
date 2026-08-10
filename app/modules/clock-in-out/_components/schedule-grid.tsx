'use client';

import {
  CheckCircle2,
  ClockIcon,
  PinIcon,
  PlusIcon,
  calculateHours,
  formatDateKey,
  formatHours,
  getShiftStyle,
  initials,
  type Employee,
  type RosterState,
  type Shift,
} from './schedule-shared';

type Props = {
  employees: Employee[];
  roster: RosterState;
  dates: Date[];
  readOnly: boolean;
  loadingEmployees: boolean;
  onAdd: (employeeId: string, dateKey: string) => void;
  onEdit: (shift: Shift) => void;
};

export function ScheduleGrid({ employees, roster, dates, readOnly, loadingEmployees, onAdd, onEdit }: Props) {
  const shiftsAt = (empId: string, dateKey: string): Shift[] => roster[empId]?.[dateKey] ?? [];

  return (
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
            {employees.map((emp) => {
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
                                onClick={() => onEdit(s)}
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
                              onClick={() => onAdd(emp.id, dateKey)}
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

            {employees.length === 0 && (
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
  );
}
