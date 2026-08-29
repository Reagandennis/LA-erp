'use client';

import { useMemo } from 'react';

import {
  Avatar,
  colourOf,
  dateKey,
  formatDayName,
  formatHours,
  hoursBetween,
  isSameDay,
  leaveCoversDate,
  LEAVE_COLOURS,
  type Holiday,
  type Leave,
  type Person,
  type Shift,
  type ShiftTemplate,
} from './planning-shared';

/**
 * Colour for a shift with no pattern attached — those created before patterns
 * existed, or added with custom times. Falls back to the time of day so the
 * board still separates nights from mornings visually.
 */
function fallbackColour(block: { type: string; startTime?: string | null }): string {
  if (block.type === 'work-night') return 'violet';
  if (block.startTime && block.startTime >= '12:00') return 'amber';
  return 'blue';
}

/**
 * The week/day board: one column per day, shifts stacked as cards.
 *
 * Day-first rather than the person×day matrix the old schedule used — that
 * matrix grew a column per person and became unreadable past a handful of
 * staff, whereas a day column stays the same width however many people work it.
 */

export default function BoardView({
  days,
  people,
  shifts,
  leave,
  holidays,
  templates,
  templateFilter,
  canManage,
  onAdd,
  onEdit,
}: {
  days: Date[];
  people: Person[];
  shifts: Shift[];
  leave: Leave[];
  holidays: Holiday[];
  templates: ShiftTemplate[];
  templateFilter: string;
  canManage: boolean;
  onAdd: (key: string) => void;
  onEdit: (shift: Shift) => void;
}) {
  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const templateById = useMemo(() => new Map(templates.map((t) => [t.id, t])), [templates]);
  const holidayByDate = useMemo(() => new Map(holidays.map((h) => [h.date, h])), [holidays]);
  const today = new Date();

  /** Shifts grouped by day, filtered to the selected pattern. */
  const byDate = useMemo(() => {
    const template = templates.find((t) => t.id === templateFilter);
    const map = new Map<string, Shift[]>();
    for (const shift of shifts) {
      if (template) {
        // Prefer the stored link; fall back to the time window so shifts made
        // before patterns existed still filter sensibly.
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
    <div className="min-h-0 flex-1 overflow-auto">
      <div
        className="grid min-w-[64rem] gap-px bg-gray-100"
        style={{ gridTemplateColumns: `repeat(${days.length}, minmax(11rem, 1fr))` }}
      >
        {days.map((day) => {
          const key = dateKey(day);
          const holiday = holidayByDate.get(key);
          const dayShifts = byDate.get(key) ?? [];
          const dayLeave = approvedLeave.filter((l) => leaveCoversDate(l, key));
          const isToday = isSameDay(day, today);

          return (
            <div key={key} className="flex min-h-[24rem] flex-col bg-white">
              <div
                className={`sticky top-0 z-10 border-b px-3 py-2 ${
                  isToday ? 'border-primary/30 bg-primary/5' : 'border-gray-100 bg-white'
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-semibold text-gray-600">{formatDayName(day)}</span>
                  <span
                    className={`text-lg font-bold ${isToday ? 'text-primary' : 'text-gray-900'}`}
                  >
                    {day.getDate()}
                  </span>
                </div>
                {holiday && (
                  <span className="mt-0.5 block truncate text-[10px] font-semibold uppercase tracking-wide text-rose-500">
                    {holiday.name}
                  </span>
                )}
              </div>

              <div className="flex flex-1 flex-col gap-2 p-2">
                {dayLeave.map((entry) => (
                  <div
                    key={entry.id}
                    className={`rounded-lg px-2.5 py-1.5 text-[11px] ${LEAVE_COLOURS[entry.type].chip}`}
                  >
                    <span className="font-semibold">{entry.userName}</span> ·{' '}
                    {LEAVE_COLOURS[entry.type].label} leave
                  </div>
                ))}

                {dayShifts.map((shift) => {
                  const person = peopleById.get(shift.employeeId);
                  const hours = hoursBetween(shift.block.startTime, shift.block.endTime);
                  const template = shift.templateId ? templateById.get(shift.templateId) : undefined;
                  const tone = colourOf(template?.colour ?? fallbackColour(shift.block));
                  return (
                    <button
                      key={shift.id}
                      type="button"
                      onClick={() => onEdit(shift)}
                      className={`rounded-xl border border-l-4 border-gray-100 ${tone.bar} bg-white p-2.5 text-left shadow-sm transition hover:shadow-md`}
                    >
                      <span className="flex items-center gap-1.5">
                        <Avatar name={person?.name ?? 'Unassigned'} size="sm" />
                        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-gray-700">
                          {person?.name ?? 'Unassigned'}
                        </span>
                      </span>
                      <span className="mt-1 block truncate text-xs font-medium text-gray-900">
                        {shift.block.role || shift.block.statusLabel || 'Shift'}
                      </span>
                      {template && (
                        <span className="mt-1 block truncate text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                          {template.name}
                        </span>
                      )}
                      <span className="mt-1.5 flex items-center gap-1.5">
                        <span
                          className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${tone.chip}`}
                        >
                          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <circle cx="12" cy="12" r="9" strokeWidth={2} />
                            <path strokeLinecap="round" strokeWidth={2} d="M12 7v5l3 2" />
                          </svg>
                          {shift.block.timeLabel || formatHours(hours) || '—'}
                        </span>
                        {shift.block.location && (
                          <span className="truncate text-[10px] text-gray-400">{shift.block.location}</span>
                        )}
                      </span>
                    </button>
                  );
                })}

                {canManage && (
                  <button
                    type="button"
                    onClick={() => onAdd(key)}
                    className="mt-auto rounded-xl border border-dashed border-gray-200 py-2 text-[11px] font-medium text-gray-400 transition hover:border-primary/40 hover:text-primary"
                  >
                    + Add shift
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
