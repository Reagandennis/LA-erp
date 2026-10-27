'use client';

import { useState } from 'react';

import type { CrewOption, CrewOptions } from '../../types';

/** Rows rendered at once; the registers run to hundreds. */
const MAX_ROWS = 80;

function ResourcePicker({
  label,
  required,
  placeholder,
  options,
  value,
  onChange,
}: {
  label: string;
  required: boolean;
  placeholder: string;
  options: CrewOption[];
  value: number | null;
  onChange: (id: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = options.find((option) => option.id === value) ?? null;
  const normalized = query.trim().toLowerCase();
  const matches = options.filter(
    (o) =>
      normalized === '' ||
      o.label.toLowerCase().includes(normalized) ||
      (o.hint?.toLowerCase().includes(normalized) ?? false),
  );
  const onTrip = matches.filter((o) => o.onTrip);
  const others = matches.filter((o) => !o.onTrip);

  const close = () => {
    setOpen(false);
    setQuery('');
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
                  const first = onTrip[0] ?? others[0];
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
              {group('On this trip', onTrip)}
              {group(onTrip.length > 0 ? 'Everyone else' : 'Task Assignment register', others)}
              {matches.length === 0 && <li className="px-3 py-3 text-sm text-gray-400">No match.</li>}
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
 * registers. A driver and a vehicle are needed; the CPO isn't. An imported
 * record that only has them as text keeps working without being re-linked.
 */
export function CrewFields({
  options,
  driverId,
  officerId,
  vehicleId,
  onChange,
  legacyDriver,
  legacyVehicle,
}: {
  options: CrewOptions;
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

  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Crew · from Task Assignment</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <ResourcePicker
          label="Driver"
          required={!legacyDriver}
          placeholder="Choose a driver"
          options={options.drivers}
          value={driverId}
          onChange={(id) => onChange({ driverId: id })}
        />
        <ResourcePicker
          label="Vehicle"
          required={!legacyVehicle}
          placeholder="Choose a vehicle"
          options={options.vehicles}
          value={vehicleId}
          onChange={(id) => onChange({ vehicleId: id })}
        />
        <ResourcePicker
          label="Close Protection Officer"
          required={false}
          placeholder="None"
          options={options.officers}
          value={officerId}
          onChange={(id) => onChange({ officerId: id })}
        />
      </div>
      {imported && (!driverId || !vehicleId) && (
        <p className="mt-2 text-xs text-gray-500">
          Imported record lists {imported}. Pick them here to link the Task Assignment record.
        </p>
      )}
    </div>
  );
}
