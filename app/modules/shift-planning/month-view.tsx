'use client';

import { useMemo } from 'react';

import {
  colourOf,
  dateKey,
  formatHours,
  hoursBetween,
  isSameDay,
  leaveCoversDate,
  LEAVE_COLOURS,
  monthGrid,
  WEEKDAY_LABELS,
  type Holiday,
  type Leave,
  type Person,
  type Shift,
  type ShiftTemplate,
} from './planning-shared';

/**
 * Month overview of the roster.
 *
 * Each day is a stack of compact pills rather than full cards — a month of full
 * cards doesn't fit, and at this zoom what matters is the shape of coverage:
 * which patterns run when, and where the gaps are. Clicking a day drops into
 * the week that contains it.
 */

/** Pills shown before collapsing into a "+N more" line. */
const MAX_PILLS = 3;

export default function MonthView({
  anchor,
  people,
  shifts,
  leave,
  holidays,
  templates,
  templateFilter,
  canManage,
  onOpenDay,
  onAdd,
}: {
  anchor: Date;
  people: Person[];
  shifts: Shift[];
  leave: Leave[];
  holidays: Holiday[];
  templates: ShiftTemplate[];
  templateFilter: string;
  canManage: boolean;
  onOpenDay: (day: Date) => void;
  onAdd: (key: string) => void;
}) {
  const days = useMemo(() => monthGrid(anchor), [anchor]);
  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const templateById = useMemo(() => new Map(templates.map((t) => [t.id, t])), [templates]);
  const holidayByDate = useMemo(() => new Map(holidays.map((h) => [h.date, h])), [holidays]);
  const month = anchor.getMonth();
  const today = new Date();

  const byDate = useMemo(() => {
    const template = templates.find((t) => t.id === templateFilter);
    const map = new Map<string, Shift[]>();
    for (const shift of shifts) {
      if (template) {
        const matches = shift.templateId
          ? shift.templateId === template.id
          : Boolean(
              shift.block.startTime &&
                shift.block.startTime >= template.startTime &&
                shift.block.startTime < template.endTime,
            );
        if (!matches) continue;
      }
      const list = map.get(shift.date) ?? [];
      list.push(shift);
      map.set(shift.date, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.block.startTime ?? '').localeCompare(b.block.startTime ?? ''));
    }
    return map;
  }, [shifts, templates, templateFilter]);

  const approvedLeave = useMemo(() => leave.filter((l) => l.status === 'approved'), [leave]);

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white">
        <div className="grid grid-cols-7 border-b border-gray-100">
          {WEEKDAY_LABELS.map((label) => (
            <div
              key={label}
              className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-gray-400"
            >
              {label}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-px bg-gray-100">
          {days.map((day) => {
            const key = dateKey(day);
            const inMonth = day.getMonth() === month;
            const holiday = holidayByDate.get(key);
            const dayShifts = byDate.get(key) ?? [];
            const dayLeave = approvedLeave.filter((l) => leaveCoversDate(l, key));
            const isToday = isSameDay(day, today);
            const hidden = Math.max(0, dayShifts.length - MAX_PILLS);

            return (
              <div
                key={key}
                className={`group relative flex min-h-[8rem] flex-col bg-white p-1.5 ${
                  inMonth ? '' : 'bg-gray-50/60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => onOpenDay(day)}
                    className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-semibold transition ${
                      isToday
                        ? 'bg-primary text-white'
                        : inMonth
                          ? 'text-gray-900 hover:bg-gray-100'
                          : 'text-gray-300'
                    }`}
                    title="Open this week"
                  >
                    {day.getDate()}
                  </button>
                  {canManage && inMonth && (
                    <button
                      type="button"
                      onClick={() => onAdd(key)}
                      aria-label={`Add a shift on ${key}`}
                      className="rounded-md p-0.5 text-gray-300 opacity-0 transition hover:bg-gray-100 hover:text-gray-600 group-hover:opacity-100"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeWidth={2} d="M12 5v14m7-7H5" />
                      </svg>
                    </button>
                  )}
                </div>

                {holiday && (
                  <p className="truncate text-[10px] font-semibold text-rose-500" title={holiday.name}>
                    {holiday.name}
                  </p>
                )}

                <div className="mt-1 space-y-0.5">
                  {dayLeave.slice(0, 1).map((entry) => (
                    <p
                      key={entry.id}
                      className={`truncate rounded px-1 py-0.5 text-[10px] ${LEAVE_COLOURS[entry.type].chip}`}
                      title={`${entry.userName} · ${LEAVE_COLOURS[entry.type].label} leave`}
                    >
                      {entry.userName} away
                    </p>
                  ))}

                  {dayShifts.slice(0, MAX_PILLS).map((shift) => {
                    const template = shift.templateId ? templateById.get(shift.templateId) : undefined;
                    const tone = colourOf(
                      template?.colour ??
                        (shift.block.type === 'work-night'
                          ? 'violet'
                          : shift.block.startTime && shift.block.startTime >= '12:00'
                            ? 'amber'
                            : 'blue'),
                    );
                    const person = peopleById.get(shift.employeeId);
                    const hours = hoursBetween(shift.block.startTime, shift.block.endTime);
                    return (
                      <button
                        key={shift.id}
                        type="button"
                        onClick={() => onOpenDay(day)}
                        title={`${person?.name ?? 'Unassigned'} · ${shift.block.role ?? 'Shift'} · ${formatHours(hours)}`}
                        className={`flex w-full items-center gap-1 rounded px-1 py-0.5 text-left transition hover:opacity-80 ${tone.chip}`}
                      >
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} />
                        <span className="min-w-0 flex-1 truncate text-[10px] font-medium">
                          {shift.block.startTime ?? ''} {person?.name ?? 'Unassigned'}
                        </span>
                      </button>
                    );
                  })}

                  {hidden > 0 && (
                    <button
                      type="button"
                      onClick={() => onOpenDay(day)}
                      className="w-full px-1 text-left text-[10px] font-semibold text-gray-400 transition hover:text-gray-700"
                    >
                      +{hidden} more
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Key to the pattern colours used across the board and month views. */
export function TemplateLegend({ templates }: { templates: ShiftTemplate[] }) {
  if (templates.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-3">
      {templates.map((template) => (
        <span key={template.id} className="inline-flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${colourOf(template.colour).dot}`} />
          <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">
            {template.name}
          </span>
        </span>
      ))}
    </div>
  );
}
