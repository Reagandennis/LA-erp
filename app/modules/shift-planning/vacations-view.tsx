'use client';

import { useMemo, useState } from 'react';

import {
  Avatar,
  dateKey,
  isSameDay,
  leaveCoversDate,
  LEAVE_COLOURS,
  monthGrid,
  WEEKDAY_LABELS,
  type Holiday,
  type Leave,
  type LeaveType,
} from './planning-shared';

/**
 * Month calendar of time off.
 *
 * Leave is stored as a start/end range, not one row per day, so each cell asks
 * which requests overlap it. That keeps a two-week holiday a single record the
 * approver acts on once.
 */

const MAX_VISIBLE = 2;

export default function VacationsView({
  anchor,
  leave,
  holidays,
  canManage,
  onAdd,
  onDecide,
  onDelete,
}: {
  anchor: Date;
  leave: Leave[];
  holidays: Holiday[];
  canManage: boolean;
  onAdd: (key: string) => void;
  onDecide: (id: string, status: 'approved' | 'declined') => void;
  onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selected, setSelected] = useState<Leave | null>(null);

  const days = useMemo(() => monthGrid(anchor), [anchor]);
  const holidayByDate = useMemo(() => new Map(holidays.map((h) => [h.date, h])), [holidays]);
  const today = new Date();
  const month = anchor.getMonth();

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
            const entries = leave.filter((l) => leaveCoversDate(l, key));
            const isToday = isSameDay(day, today);
            const showAll = expanded === key;
            const visible = showAll ? entries : entries.slice(0, MAX_VISIBLE);

            return (
              <div
                key={key}
                className={`group relative min-h-[7rem] bg-white p-2 ${inMonth ? '' : 'bg-gray-50/60'}`}
              >
                <div className="flex items-start justify-between">
                  <span
                    className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-semibold ${
                      isToday
                        ? 'bg-primary text-white'
                        : inMonth
                          ? 'text-gray-900'
                          : 'text-gray-300'
                    }`}
                  >
                    {day.getDate()}
                  </span>
                  {canManage && inMonth && (
                    <button
                      type="button"
                      onClick={() => onAdd(key)}
                      aria-label={`Add leave on ${key}`}
                      className="rounded-md p-0.5 text-gray-300 opacity-0 transition hover:bg-gray-100 hover:text-gray-600 group-hover:opacity-100"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeWidth={2} d="M12 5v14m7-7H5" />
                      </svg>
                    </button>
                  )}
                </div>

                {holiday && (
                  <p className="mt-0.5 truncate text-[10px] font-semibold text-rose-500" title={holiday.name}>
                    {holiday.name}
                  </p>
                )}

                <div className="mt-1 space-y-1">
                  {visible.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => setSelected(entry)}
                      className="flex w-full items-center gap-1.5 rounded-lg bg-gray-50 px-1.5 py-1 text-left transition hover:bg-gray-100"
                    >
                      <Avatar name={entry.userName} size="sm" />
                      <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-gray-700">
                        {entry.userName}
                      </span>
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${LEAVE_COLOURS[entry.type].dot} ${
                          entry.status === 'pending' ? 'ring-2 ring-amber-300' : ''
                        }`}
                        title={
                          entry.status === 'pending'
                            ? `${LEAVE_COLOURS[entry.type].label} · awaiting approval`
                            : LEAVE_COLOURS[entry.type].label
                        }
                      />
                    </button>
                  ))}
                  {entries.length > MAX_VISIBLE && (
                    <button
                      type="button"
                      onClick={() => setExpanded(showAll ? null : key)}
                      className="w-full rounded-lg px-1.5 py-0.5 text-left text-[10px] font-semibold text-gray-400 transition hover:text-gray-700"
                    >
                      {showAll ? 'Show less' : `${entries.length - MAX_VISIBLE} More`}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {selected && (
        <>
          <div
            className="fixed inset-0 z-[220] bg-gray-900/20 backdrop-blur-sm"
            onClick={() => setSelected(null)}
          />
          <div className="fixed left-1/2 top-1/2 z-[230] w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <Avatar name={selected.userName} />
                <div>
                  <p className="text-sm font-bold text-gray-900">{selected.userName}</p>
                  <p className="text-xs text-gray-500">
                    {LEAVE_COLOURS[selected.type].label} leave
                  </p>
                </div>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                  selected.status === 'approved'
                    ? 'bg-emerald-50 text-emerald-700'
                    : selected.status === 'declined'
                      ? 'bg-rose-50 text-rose-700'
                      : 'bg-amber-50 text-amber-700'
                }`}
              >
                {selected.status}
              </span>
            </div>

            <dl className="mt-4 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <dt className="text-gray-400">From</dt>
                <dd className="text-gray-700">{selected.startDate}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-400">To</dt>
                <dd className="text-gray-700">{selected.endDate}</dd>
              </div>
              {selected.decidedByName && (
                <div className="flex justify-between">
                  <dt className="text-gray-400">Decided by</dt>
                  <dd className="text-gray-700">{selected.decidedByName}</dd>
                </div>
              )}
            </dl>
            {selected.note && <p className="mt-3 rounded-lg bg-gray-50 p-2.5 text-xs text-gray-600">{selected.note}</p>}

            {canManage && (
              <div className="mt-5 space-y-2">
                {selected.status === 'pending' && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        onDecide(selected.id, 'approved');
                        setSelected(null);
                      }}
                      className="flex-1 rounded-xl bg-primary px-3.5 py-2 text-sm font-semibold text-white transition hover:opacity-90"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onDecide(selected.id, 'declined');
                        setSelected(null);
                      }}
                      className="flex-1 rounded-xl bg-gray-50 px-3.5 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
                    >
                      Decline
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => {
                    onDelete(selected.id);
                    setSelected(null);
                  }}
                  className="w-full rounded-xl px-3.5 py-2 text-sm font-medium text-rose-600 transition hover:bg-rose-50"
                >
                  Remove
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="mt-2 w-full rounded-xl px-3.5 py-2 text-sm text-gray-500 transition hover:bg-gray-50"
            >
              Close
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function LeaveLegend({ types }: { types?: LeaveType[] }) {
  const list = types ?? (Object.keys(LEAVE_COLOURS) as LeaveType[]);
  return (
    <div className="flex flex-wrap items-center gap-3">
      {list.map((type) => (
        <span key={type} className="inline-flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${LEAVE_COLOURS[type].dot}`} />
          <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">
            {LEAVE_COLOURS[type].label}
          </span>
        </span>
      ))}
    </div>
  );
}
