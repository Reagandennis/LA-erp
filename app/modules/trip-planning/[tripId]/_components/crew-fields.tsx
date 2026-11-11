'use client';

import { useState } from 'react';

import { APP_LOCALE } from '@/lib/locale';
import { type DayLogKind, formatDateRange, inPool, poolCrewFilter } from '@/lib/trip-resource-model';

import type { CrewOption, CrewOptions } from '../../types';
import { DayShiftLog, type LogSubject } from './day-shift-log';
import { useTripPool } from './trip-pool';

/** Rows rendered at once; the registers run to hundreds. */
const MAX_ROWS = 80;

function ResourcePicker({
  label,
  required,
  placeholder,
  options,
  poolIds,
  value,
  onChange,
}: {
  label: string;
  required: boolean;
  placeholder: string;
  options: CrewOption[];
  /** Who the trip's staged pool puts on this event's day; empty when it names no one. */
  poolIds: Set<number>;
  value: number | null;
  onChange: (id: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  /** The whole register, past what the pool offers. */
  const [everyone, setEveryone] = useState(false);
  const selected = options.find((option) => option.id === value) ?? null;
  const normalized = query.trim().toLowerCase();
  const matches = options.filter(
    (o) =>
      normalized === '' ||
      o.label.toLowerCase().includes(normalized) ||
      (o.hint?.toLowerCase().includes(normalized) ?? false),
  );
  // With a pool for the day, that is the list; the register stays one click away.
  const pooled = poolIds.size > 0;
  const fromPool = matches.filter((o) => poolIds.has(o.id));
  const outside = matches.filter((o) => !poolIds.has(o.id));
  const narrowed = pooled && !everyone;
  const onTrip = narrowed ? [] : outside.filter((o) => o.onTrip);
  const others = narrowed ? [] : outside.filter((o) => !o.onTrip);

  const close = () => {
    setOpen(false);
    setQuery('');
    setEveryone(false);
  };
  const pick = (id: number | null) => {
    onChange(id);
    close();
  };

  const row = (option: CrewOption) => (
    <li key={option.id}>
      <button
        type="button"
        onClick={() => pick(option.id)}
        className={`flex w-full items-start justify-between gap-2 px-3 py-2 text-left hover:bg-gray-50 ${
          option.id === value ? 'bg-primary/5' : ''
        }`}
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-gray-900">{option.label}</span>
          {option.hint && <span className="block truncate text-xs text-gray-500">{option.hint}</span>}
        </span>
        <span className="flex shrink-0 flex-col items-end gap-0.5">
          {option.status !== 'Available' && (
            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
              {option.status}
            </span>
          )}
          {option.busyOn && (
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
              On {option.busyOn}
            </span>
          )}
        </span>
      </button>
    </li>
  );

  const group = (title: string, list: CrewOption[]) =>
    list.length > 0 && (
      <>
        <li className="sticky top-0 bg-gray-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
          {title}
        </li>
        {list.slice(0, MAX_ROWS).map(row)}
      </>
    );

  return (
    <div className="relative">
      <span className="text-xs font-medium text-gray-500">
        {label}
        {required ? <span className="text-rose-500"> *</span> : <span className="text-gray-400"> (optional)</span>}
      </span>
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="mt-1 flex w-full items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 text-left text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
      >
        {selected ? (
          <span className="min-w-0 truncate">
            <span className="font-medium text-gray-900">{selected.label}</span>
            {selected.hint && <span className="ml-1.5 text-xs text-gray-500">{selected.hint}</span>}
          </span>
        ) : (
          <span className="text-gray-400">{placeholder}</span>
        )}
        <svg className="h-4 w-4 shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <>
          <button type="button" aria-label="Close" tabIndex={-1} className="fixed inset-0 z-30 cursor-default" onClick={close} />
          <div className="absolute z-40 mt-1 w-full min-w-[16rem] overflow-hidden rounded-xl border border-gray-100 bg-white shadow-lg">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') close();
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const first = fromPool[0] ?? onTrip[0] ?? others[0];
                  if (first) pick(first.id);
                }
              }}
              placeholder="Search…"
              className="w-full border-b border-gray-100 px-3 py-2 text-sm focus:outline-none"
            />
            <ul role="listbox" className="max-h-64 overflow-y-auto">
              {value != null && (
                <li>
                  <button
                    type="button"
                    onClick={() => pick(null)}
                    className="w-full px-3 py-2 text-left text-xs font-medium text-rose-600 hover:bg-rose-50"
                  >
                    Clear selection
                  </button>
                </li>
              )}
              {group('From the staged pool', fromPool)}
              {group('On this trip', onTrip)}
              {group(onTrip.length > 0 || fromPool.length > 0 ? 'Everyone else' : 'Task Assignment register', others)}
              {narrowed && fromPool.length === 0 && (
                <li className="px-3 py-3 text-sm text-gray-400">No one in the staged pool matches.</li>
              )}
              {narrowed && outside.length > 0 && (
                <li>
                  <button
                    type="button"
                    onClick={() => setEveryone(true)}
                    className="w-full border-t border-gray-100 px-3 py-2 text-left text-xs font-medium text-gray-500 hover:bg-gray-50 hover:text-primary"
                  >
                    Show the full register ({outside.length} more)
                  </button>
                </li>
              )}
              {!narrowed && matches.length === 0 && <li className="px-3 py-3 text-sm text-gray-400">No match.</li>}
              {others.length > MAX_ROWS && (
                <li className="px-3 py-2 text-xs text-gray-400">Keep typing to narrow {others.length} more.</li>
              )}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Driver, vehicle and CPO for a movement, picked from Task Assignment's
 * registers. None is required to save: whatever is still missing is raised
 * in the notification bell and on the ops dashboard until it's assigned. An
 * imported record that only has them as text keeps working without being re-linked.
 *
 * When the trip's staged pool covers the event's day, each picker opens on
 * the people and vehicles of the vendors staged for that day. Below the
 * pickers sits that day's shift and odometer log for whoever is picked.
 */
export function CrewFields({
  options,
  driverId,
  officerId,
  vehicleId,
  onChange,
  legacyDriver,
  legacyVehicle,
  date,
  dayId,
}: {
  options: CrewOptions;
  /** The event's date ("YYYY-MM-DD") and itinerary day, for the pool and the day's log. */
  date: string;
  dayId: number | null;
  driverId: number | null;
  officerId: number | null;
  vehicleId: number | null;
  onChange: (next: { driverId?: number | null; officerId?: number | null; vehicleId?: number | null }) => void;
  legacyDriver?: string;
  legacyVehicle?: string;
}) {
  const imported = [legacyDriver && `driver “${legacyDriver}”`, legacyVehicle && `vehicle “${legacyVehicle}”`]
    .filter(Boolean)
    .join(' and ');

  const pool = useTripPool();
  const filter = poolCrewFilter(pool.resources, date || null);
  const pooledIds = (kind: DayLogKind, list: CrewOption[]) =>
    new Set(list.filter((option) => inPool(filter, kind, option)).map((option) => option.id));
  const poolDrivers = pooledIds('driver', options.drivers);
  const poolVehicles = pooledIds('vehicle', options.vehicles);
  const poolOfficers = pooledIds('officer', options.officers);
  const pooled = poolDrivers.size + poolVehicles.size + poolOfficers.size > 0;

  // The day this event sits on: by its date once it has one, else the day it was opened from.
  const day = pool.days.find((candidate) => (date ? candidate.dateKey === date : candidate.id === dayId)) ?? null;
  const picked = (kind: DayLogKind, list: CrewOption[], id: number | null): LogSubject[] => {
    const option = id == null ? null : list.find((candidate) => candidate.id === id);
    return option ? [{ kind, id: option.id, label: option.label, hint: option.hint, assigned: true }] : [];
  };
  const subjects = [
    ...picked('driver', options.drivers, driverId),
    ...picked('officer', options.officers, officerId),
    ...picked('vehicle', options.vehicles, vehicleId),
  ];

  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Crew · from Task Assignment</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <ResourcePicker
          label="Driver"
          required={false}
          placeholder="Choose a driver"
          options={options.drivers}
          poolIds={poolDrivers}
          value={driverId}
          onChange={(id) => onChange({ driverId: id })}
        />
        <ResourcePicker
          label="Vehicle"
          required={false}
          placeholder="Choose a vehicle"
          options={options.vehicles}
          poolIds={poolVehicles}
          value={vehicleId}
          onChange={(id) => onChange({ vehicleId: id })}
        />
        <ResourcePicker
          label="Close Protection Officer"
          required={false}
          placeholder="None"
          options={options.officers}
          poolIds={poolOfficers}
          value={officerId}
          onChange={(id) => onChange({ officerId: id })}
        />
      </div>
      {pooled && (
        <p className="mt-2 text-xs text-gray-500">
          Each list opens on the vendors staged for {date ? formatDateRange(date, date, APP_LOCALE) : 'this trip'} in Trip Resources.
        </p>
      )}
      {imported && (!driverId || !vehicleId) && (
        <p className="mt-2 text-xs text-gray-500">
          Imported record lists {imported}. Pick them here to link the Task Assignment record.
        </p>
      )}
      {pool.tripId > 0 && subjects.length > 0 && (
        <div className="mt-3">
          {day ? (
            <DayShiftLog
              key={day.id}
              tripId={pool.tripId}
              dayId={day.id}
              title={`Daily shift & odometer log · ${day.dateKey ? formatDateRange(day.dateKey, day.dateKey, APP_LOCALE) : `Day ${day.dayNumber}`}`}
              subjects={subjects}
              logs={pool.dayLogs.filter((log) => log.dayId === day.id)}
              canEdit={pool.canEdit}
              // The day's full log sits open at the top of the day; this is the same lines, for this event's crew.
              defaultOpen={false}
              onSaved={pool.onTripChange}
            />
          ) : (
            <p className="text-xs text-gray-400">
              The daily shift and odometer log opens once this event is saved on a day.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
