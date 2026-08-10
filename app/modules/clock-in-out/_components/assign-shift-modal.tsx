'use client';

import { useEffect, useState } from 'react';

import {
  PRESETS,
  XIcon,
  calculateHours,
  formatClock,
  formatHours,
  type Employee,
  type Shift,
  type ShiftBlock,
} from './schedule-shared';

export type EditingState = {
  dateKey: string;
  employeeId?: string; // fixed employee (grid / timeline / editing an existing shift)
  shiftId?: number; // present when editing an existing shift
  shift?: Shift; // the shift being edited
  pickEmployee?: boolean; // month "add" with no row context → show an employee picker
};

type Props = {
  editing: EditingState;
  employees: Employee[];
  onApply: (block: ShiftBlock, employeeId: number) => void;
  onDelete: (id: number) => void;
  onClose: () => void;
};

export function AssignShiftModal({ editing, employees, onApply, onDelete, onClose }: Props) {
  const { shift } = editing;
  // Initialized from props on mount; the parent passes a `key` tied to the edit
  // target so the modal remounts (and re-initializes) for each open — no
  // effect-based prop syncing needed.
  const [customStart, setCustomStart] = useState(shift?.startTime ?? '09:00');
  const [customEnd, setCustomEnd] = useState(shift?.endTime ?? '17:00');
  const [prefNote, setPrefNote] = useState(shift?.note ?? '');
  const [roleInput, setRoleInput] = useState(shift?.role ?? '');
  const [locationInput, setLocationInput] = useState(shift?.location ?? '');
  const [chosenEmployee, setChosenEmployee] = useState(editing.employeeId ?? '');
  const [error, setError] = useState('');

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const editingEmp = employees.find((e) => e.id === editing.employeeId);
  const editingDate = new Date(editing.dateKey + 'T12:00:00');
  const customHours = calculateHours(customStart, customEnd);
  const isEdit = editing.shiftId != null;
  const needsPicker = Boolean(editing.pickEmployee) && !isEdit;

  const apply = (partial: ShiftBlock) => {
    const employeeId = Number(isEdit ? editing.employeeId : needsPicker ? chosenEmployee : editing.employeeId);
    if (!Number.isInteger(employeeId) || employeeId <= 0) {
      setError('Choose an employee first.');
      return;
    }
    const block: ShiftBlock = {
      ...partial,
      role: roleInput.trim() || undefined,
      location: locationInput.trim() || undefined,
    };
    onApply(block, employeeId);
  };

  return (
    <>
      <button type="button" aria-label="Close" className="fixed inset-0 z-[300] bg-slate-900/30 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-[310] w-full max-w-md -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <h3 className="text-base font-bold text-gray-900">{isEdit ? 'Edit shift' : 'Add shift'}</h3>
            <p className="text-xs text-gray-500">
              {editingEmp ? `${editingEmp.name} · ` : ''}
              {editingDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg bg-gray-50 p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[70vh] space-y-5 overflow-y-auto px-6 py-5">
          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-600">{error}</p>}

          {/* Employee picker (calendar adds only) */}
          {needsPicker && (
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-gray-500">Employee</span>
              <select
                value={chosenEmployee}
                onChange={(e) => setChosenEmployee(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                <option value="">Select an employee…</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
            </label>
          )}

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
                  onClick={() => apply({ type: 'work-day', startTime: p.start, endTime: p.end, timeLabel: `${formatClock(p.start)}–${formatClock(p.end)}` })}
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
                onClick={() => apply({ type: 'work-day', startTime: customStart, endTime: customEnd, timeLabel: `${formatClock(customStart)}–${formatClock(customEnd)}` })}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                {isEdit ? 'Save' : 'Add'}
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-gray-400">Duration: {formatHours(customHours)}{customHours === 0 ? ' (set an end after the start)' : ''}</p>
          </div>

          {/* Status / availability */}
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-gray-400">Status</p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => apply({ type: 'available', statusLabel: 'Available' })} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-slate-600 hover:border-slate-300 hover:bg-slate-50">Available</button>
              <button onClick={() => apply({ type: 'vacation', statusLabel: 'Unavailable\nVacation' })} className="rounded-xl border border-red-200 bg-red-50/40 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50">Vacation</button>
            </div>
            <div className="mt-2 flex items-end gap-2">
              <label className="flex-1">
                <span className="mb-1 block text-[11px] font-medium text-gray-500">Preference note (optional)</span>
                <input type="text" value={prefNote} onChange={(e) => setPrefNote(e.target.value)} placeholder="e.g. Prefers mornings" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
              </label>
              <button
                onClick={() => apply({ type: 'preference', statusLabel: prefNote ? `Prefers:\n${prefNote}` : 'Preferred', note: prefNote })}
                className="rounded-lg border border-teal-200 bg-teal-50 px-4 py-2 text-sm font-semibold text-teal-700 hover:bg-teal-100"
              >
                Set
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-gray-100 px-6 py-3">
          <button
            onClick={() => editing.shiftId != null && onDelete(editing.shiftId)}
            disabled={editing.shiftId == null}
            className="text-sm font-semibold text-rose-500 hover:text-rose-700 disabled:opacity-40"
          >
            Delete shift
          </button>
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-semibold text-gray-500 hover:text-gray-700">Close</button>
        </div>
      </div>
    </>
  );
}
