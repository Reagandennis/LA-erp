'use client';

import { useState } from 'react';

import { SILENT_BANNER_HEADER } from '@/app/ui/banner';
import {
  type DayLogKind,
  type TripDayLogSummary,
  dayTotals,
  distanceKm,
  formatHours,
  shiftHours,
} from '@/lib/trip-resource-model';

import type { TripDetail, TripItineraryItemSummary } from '../../types';

/** Someone or something the day's log has a line for. */
export interface LogSubject {
  kind: DayLogKind;
  id: number;
  label: string;
  hint: string | null;
  /** On an event this day; false for a line kept from before they were taken off. */
  assigned: boolean;
}

const KIND_LABEL: Record<DayLogKind, string> = { driver: 'Driver', officer: 'CPO', vehicle: 'Vehicle' };
const KIND_ORDER: Record<DayLogKind, number> = { driver: 0, officer: 1, vehicle: 2 };

/**
 * Everyone and everything with a line in a day's log: the drivers, CPOs and
 * vehicles on that day's events, plus anyone already logged who has since
 * been taken off them (their hours still count).
 */
export function daySubjects(items: readonly TripItineraryItemSummary[], logs: readonly TripDayLogSummary[]): LogSubject[] {
  const subjects = new Map<string, LogSubject>();
  const add = (subject: LogSubject) => {
    const key = `${subject.kind}:${subject.id}`;
    if (!subjects.has(key)) subjects.set(key, subject);
  };
  for (const item of items) {
    if (item.driver) add({ kind: 'driver', id: item.driver.id, label: item.driver.name, hint: item.driver.phone, assigned: true });
    if (item.officer) {
      add({ kind: 'officer', id: item.officer.id, label: item.officer.name, hint: item.officer.callSign ?? item.officer.grade, assigned: true });
    }
    if (item.vehicle) {
      const model = [item.vehicle.make, item.vehicle.model].filter(Boolean).join(' ');
      add({ kind: 'vehicle', id: item.vehicle.id, label: item.vehicle.registration, hint: model || item.vehicle.type, assigned: true });
    }
  }
  for (const log of logs) {
    if (log.subjectId != null) add({ kind: log.kind, id: log.subjectId, label: log.label, hint: null, assigned: false });
  }
  return [...subjects.values()].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.label.localeCompare(b.label));
}

interface Draft {
  shiftStart: string;
  shiftEnd: string;
  startOdometer: string;
  endOdometer: string;
}

function draftOf(log: TripDayLogSummary | undefined): Draft {
  return {
    shiftStart: log?.shiftStart ?? '',
    shiftEnd: log?.shiftEnd ?? '',
    startOdometer: log?.startOdometer != null ? String(log.startOdometer) : '',
    endOdometer: log?.endOdometer != null ? String(log.endOdometer) : '',
  };
}

function odometer(value: string): number | null | 'invalid' {
  if (value.trim() === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 9_999_999 ? n : 'invalid';
}

const inputClass =
  'w-full rounded-lg bg-white px-2.5 py-1.5 text-sm tabular-nums ring-1 ring-gray-200 focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:bg-gray-50 disabled:text-gray-500';
const captionClass = 'text-[10px] font-medium uppercase tracking-wider text-gray-400';

function LogRow({
  tripId,
  dayId,
  subject,
  log,
  canEdit,
  onSaved,
}: {
  tripId: number;
  dayId: number;
  subject: LogSubject;
  log: TripDayLogSummary | undefined;
  canEdit: boolean;
  onSaved: (trip: TripDetail) => void;
}) {
  // Follows the saved line field by field, so a colleague's entry shows up
  // without wiping the one being typed here (each is saved on leaving it).
  const server = draftOf(log);
  const [draft, setDraft] = useState<Draft>(server);
  const [seen, setSeen] = useState<Draft>(server);
  if (JSON.stringify(server) !== JSON.stringify(seen)) {
    setSeen(server);
    setDraft((current) => {
      const next = { ...current };
      for (const key of Object.keys(server) as Array<keyof Draft>) {
        if (current[key] === seen[key]) next[key] = server[key];
      }
      return next;
    });
  }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const vehicle = subject.kind === 'vehicle';

  const save = async (next: Draft) => {
    if (JSON.stringify(next) === JSON.stringify(server)) return;
    const start = odometer(next.startOdometer);
    const end = odometer(next.endOdometer);
    if (vehicle && (start === 'invalid' || end === 'invalid')) {
      setError('Odometer readings are whole kilometres');
      return;
    }
    if (vehicle && typeof start === 'number' && typeof end === 'number' && end < start) {
      setError('The end reading is behind the start');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const response = await fetch(`/api/trips/${tripId}/days/${dayId}/logs`, {
        method: 'PUT',
        credentials: 'include',
        // Saved field by field: a banner on every one would be noise.
        headers: { 'Content-Type': 'application/json', [SILENT_BANNER_HEADER]: '1' },
        body: JSON.stringify({
          kind: subject.kind,
          subjectId: subject.id,
          shiftStart: vehicle ? null : next.shiftStart || null,
          shiftEnd: vehicle ? null : next.shiftEnd || null,
          startOdometer: vehicle ? start : null,
          endOdometer: vehicle ? end : null,
        }),
      });
      const data = (await response.json().catch(() => null)) as { trip?: TripDetail; error?: string } | null;
      if (!response.ok || !data?.trip) {
        setError(data?.error ?? 'Could not save this line');
        return;
      }
      onSaved(data.trip);
    } finally {
      setSaving(false);
    }
  };

  const field = (key: keyof Draft, label: string, type: 'time' | 'number') => (
    <label className="block">
      <span className={captionClass}>{label}</span>
      <div className="relative mt-0.5">
        <input
          type={type}
          inputMode={type === 'number' ? 'numeric' : undefined}
          min={type === 'number' ? 0 : undefined}
          step={type === 'number' ? 1 : undefined}
          value={draft[key]}
          disabled={!canEdit}
          onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
          onBlur={() => void save(draft)}
          className={`${inputClass} ${type === 'number' ? 'pr-8' : ''}`}
        />
        {type === 'number' && (
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-gray-400">km</span>
        )}
      </div>
    </label>
  );

  const hours = vehicle ? null : shiftHours(draft.shiftStart || null, draft.shiftEnd || null);
  const start = odometer(draft.startOdometer);
  const end = odometer(draft.endOdometer);
  const km = vehicle && typeof start === 'number' && typeof end === 'number' ? distanceKm(start, end) : null;
  const total = vehicle ? (km !== null ? `${km.toLocaleString()} km` : null) : hours !== null ? formatHours(hours) : null;

  return (
    <div className="px-3 py-2.5">
      <div className="grid grid-cols-2 items-end gap-x-2 gap-y-2 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_5.5rem]">
        <div className="col-span-2 min-w-0 sm:col-span-1">
          <p className="truncate text-sm font-semibold text-gray-900">{subject.label}</p>
          <p className="truncate text-[11px] text-gray-500">
            {/* A CPO's hint often opens with the grade "CPO" already. */}
            {subject.hint?.startsWith(KIND_LABEL[subject.kind]) ? subject.hint : [KIND_LABEL[subject.kind], subject.hint].filter(Boolean).join(' · ')}
            {!subject.assigned && <span className="text-amber-700"> · no longer on an event this day</span>}
          </p>
        </div>
        {vehicle ? field('startOdometer', 'Start odometer', 'number') : field('shiftStart', 'Shift start', 'time')}
        {vehicle ? field('endOdometer', 'End odometer', 'number') : field('shiftEnd', 'Shift end', 'time')}
        <div className="col-span-2 sm:col-span-1 sm:text-right">
          <p className={captionClass}>{vehicle ? 'Driven' : 'On shift'}</p>
          <p className={`mt-0.5 py-1.5 text-sm font-semibold tabular-nums ${total ? 'text-gray-900' : 'text-gray-300'}`}>
            {saving ? <span className="font-normal text-gray-400">Saving…</span> : (total ?? '—')}
          </p>
        </div>
      </div>
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
    </div>
  );
}

/**
 * A day's shift and odometer log: when each driver and CPO started and
 * finished, and each vehicle's readings at either end of the day. The hours
 * and kilometres it adds up are what billing reads for that day.
 */
export function DayShiftLog({
  tripId,
  dayId,
  title,
  subjects,
  logs,
  canEdit,
  defaultOpen,
  onSaved,
}: {
  tripId: number;
  dayId: number;
  /** "Daily shift & odometer log · Nov 8". */
  title: string;
  subjects: LogSubject[];
  /** This day's saved lines. */
  logs: TripDayLogSummary[];
  canEdit: boolean;
  defaultOpen: boolean;
  onSaved: (trip: TripDetail) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (subjects.length === 0) return null;

  const logFor = (subject: LogSubject) => logs.find((log) => log.kind === subject.kind && log.subjectId === subject.id);
  const shown = logs.filter((log) => subjects.some((subject) => subject.kind === log.kind && subject.id === log.subjectId));
  const totals = dayTotals(shown);
  const unlogged = subjects.length - shown.length + totals.open;
  const people = subjects.filter((subject) => subject.kind !== 'vehicle').length;
  const vehicles = subjects.length - people;

  const summary = [
    people > 0 ? `${people} ${people === 1 ? 'person' : 'people'}` : null,
    vehicles > 0 ? `${vehicles} vehicle${vehicles === 1 ? '' : 's'}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-gray-50/60">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left"
      >
        <span className="min-w-[12rem] flex-1">
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-gray-500">{title}</span>
          <span className="block text-xs text-gray-500">{summary}</span>
        </span>
        <span className="flex items-center gap-2 text-xs">
          {totals.hours > 0 && <span className="rounded-md bg-white px-2 py-0.5 font-semibold tabular-nums text-gray-800 ring-1 ring-gray-200">{formatHours(totals.hours)}</span>}
          {totals.km > 0 && <span className="rounded-md bg-white px-2 py-0.5 font-semibold tabular-nums text-gray-800 ring-1 ring-gray-200">{totals.km.toLocaleString()} km</span>}
          {unlogged > 0 && <span className="rounded-md bg-amber-50 px-2 py-0.5 font-medium text-amber-700">{unlogged} to log</span>}
        </span>
        <svg className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="divide-y divide-gray-100 border-t border-gray-200 bg-white">
          {subjects.map((subject) => (
            <LogRow
              key={`${subject.kind}:${subject.id}`}
              tripId={tripId}
              dayId={dayId}
              subject={subject}
              log={logFor(subject)}
              canEdit={canEdit}
              onSaved={onSaved}
            />
          ))}
        </div>
      )}
    </section>
  );
}
