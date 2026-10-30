'use client';

import { useMemo, useState } from 'react';

import type { FlightCandidate, LookupAirport } from '@/lib/flight-status';
import { APP_LOCALE } from '@/lib/locale';
import { allTimeZones, localTimeZone, offsetLabel, weekdayOf } from '@/lib/zoned-time';

import { REMINDER_OPTIONS, type CrewOptions, type TripDaySummary } from '../../types';
import type { EditorState } from '../editor-state';
import { dayLabel } from '../itinerary-model';
import { CrewFields } from './crew-fields';
import { AirportInput, FlightNumberLookup, seenOn } from './flight-lookup';
import ServicePicker from './service-picker';

/** Zones offered above the full list: this office's, then the usual hubs. */
const COMMON_ZONES = [
  'Africa/Nairobi',
  'UTC',
  'Africa/Johannesburg',
  'Africa/Lagos',
  'Africa/Cairo',
  'Asia/Dubai',
  'Europe/London',
  'Europe/Paris',
  'Asia/Kolkata',
  'Asia/Singapore',
  'America/New_York',
];

const CABINS = ['Economy', 'Premium economy', 'Business', 'First'];

function zoneName(zone: string) {
  return zone.replace(/_/g, ' ');
}

/**
 * The flight form. Whether the event is a departure or an arrival is chosen
 * first, and the airport and time fields below take their meaning from it:
 * the time entered is local to that airport, in the zone picked beside it.
 */
export default function FlightFields({
  editor,
  patch,
  days,
  crewOptions,
  showCost,
  tripCountry,
}: {
  editor: EditorState;
  patch: (next: Partial<EditorState>) => void;
  days: TripDaySummary[];
  crewOptions: CrewOptions;
  showCost: boolean;
  /** The service picker opens on it. */
  tripCountry: string | null;
}) {
  const arrival = editor.timeLabel === 'ARRIVAL';
  const labelClass = 'text-xs font-medium text-gray-500';
  const fieldClass =
    'mt-1 w-full rounded-lg bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30';
  const setDetail = (key: string, value: string) => patch({ details: { ...editor.details, [key]: value } });

  // The airport the event happens at, and the one at the other end.
  const hereKey = arrival ? 'arriveAirport' : 'departAirport';
  const thereKey = arrival ? 'departAirport' : 'arriveAirport';

  /**
   * A look-up fills the airline, both airports, this end's local time and zone,
   * and the duration in one patch (patch replaces the editor wholesale, so two
   * calls in one event would lose the first). What it replaced is kept for Undo.
   */
  const [filled, setFilled] = useState<{ candidate: FlightCandidate; before: Partial<EditorState> } | null>(null);
  const applyCandidate = (candidate: FlightCandidate) => {
    const here = arrival ? candidate.destination : candidate.origin;
    const time = arrival ? candidate.arrivalTime : candidate.departureTime;
    setFilled({
      candidate,
      before: {
        providerName: editor.providerName,
        timezone: editor.timezone,
        time: editor.time,
        durationHours: editor.durationHours,
        durationMinutes: editor.durationMinutes,
        details: editor.details,
      },
    });
    patch({
      providerName: candidate.airline?.name ?? editor.providerName,
      timezone: here?.tz ?? editor.timezone,
      time: time ?? editor.time,
      ...(candidate.durationMinutes != null
        ? { durationHours: String(Math.floor(candidate.durationMinutes / 60)), durationMinutes: String(candidate.durationMinutes % 60) }
        : {}),
      details: {
        ...editor.details,
        flightNumber: candidate.flightNumber,
        departAirport: candidate.origin?.iata ?? editor.details.departAirport ?? '',
        arriveAirport: candidate.destination?.iata ?? editor.details.arriveAirport ?? '',
      },
    });
  };
  const undoFill = () => {
    if (!filled) return;
    patch(filled.before);
    setFilled(null);
  };
  // Picking this end's airport also sets the zone its time is in.
  const pickAirport = (key: string, airport: LookupAirport) =>
    patch({ details: { ...editor.details, [key]: airport.iata }, ...(key === hereKey && airport.tz ? { timezone: airport.tz } : {}) });

  const switchDirection = (next: 'DEPARTURE' | 'ARRIVAL') => {
    if (next === editor.timeLabel) return;
    // Keep what was typed as "this" airport as this airport under the new label.
    patch({
      timeLabel: next,
      details: {
        ...editor.details,
        departAirport: editor.details.arriveAirport ?? '',
        arriveAirport: editor.details.departAirport ?? '',
      },
    });
  };

  const zoneOptions = useMemo(() => {
    // Offsets as of the flight's date (DST); today's when there's no date yet.
    const at = editor.date ? new Date(`${editor.date}T12:00:00Z`).getTime() : undefined;
    const label = (zone: string) => `${zoneName(zone)} (${offsetLabel(zone, at)})`;
    const all = allTimeZones();
    const common = [localTimeZone(), ...COMMON_ZONES].filter(
      (zone, i, list) => list.indexOf(zone) === i && (zone === 'UTC' || all.includes(zone)),
    );
    return {
      common: common.map((zone) => ({ zone, label: label(zone) })),
      rest: all.filter((zone) => !common.includes(zone)).map((zone) => ({ zone, label: label(zone) })),
    };
  }, [editor.date]);

  const weekday = weekdayOf(editor.date, APP_LOCALE);

  return (
    <div className="space-y-4">
      {/* Departure or arrival — everything below reads from this. */}
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1">
        {(
          [
            ['DEPARTURE', 'Departure', 'M2.5 19h19v2h-19v-2zm19.57-9.36c-.21-.8-1.04-1.28-1.84-1.06L14.92 10l-6.9-6.43-1.93.51 4.14 7.17-4.97 1.33-1.97-1.54-1.45.39 2.59 4.49L21 11.49c.81-.23 1.28-1.05 1.07-1.85z'],
            ['ARRIVAL', 'Arrival', 'M2.5 19h19v2h-19v-2zm7.18-5.73l4.35 1.16 5.31 1.42c.8.21 1.62-.26 1.84-1.06.21-.8-.26-1.62-1.06-1.84l-5.31-1.42-2.76-9.02L10.12 2v8.28L5.15 8.95l-.93-2.32-1.45-.39v5.17l1.6.43 5.31 1.43z'],
          ] as const
        ).map(([value, label, icon]) => (
          <button
            key={value}
            type="button"
            onClick={() => switchDirection(value)}
            aria-pressed={editor.timeLabel === value}
            className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition ${
              editor.timeLabel === value ? 'bg-white text-sky-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
              <path d={icon} />
            </svg>
            {label}
          </button>
        ))}
      </div>

      <FlightNumberLookup value={editor.details.flightNumber ?? ''} onChange={(value) => setDetail('flightNumber', value)} onPick={applyCandidate} />
      {filled && (
        <p className="-mt-2 text-xs text-sky-800">
          Filled from {filled.candidate.runs} recent {filled.candidate.runs === 1 ? 'run' : 'runs'} of {filled.candidate.flightNumber}
          {seenOn(filled.candidate.lastSeen) && ` · last seen ${seenOn(filled.candidate.lastSeen)}`}
          {filled.candidate.aircraft && ` · ${filled.candidate.aircraft}`}. Typical times, so check them against the ticket.
          {!(arrival ? filled.candidate.arrivalTime : filled.candidate.departureTime) && ' No local time was known, so set the time by hand.'}{' '}
          <button type="button" onClick={undoFill} className="font-semibold underline">
            Undo
          </button>
        </p>
      )}

      <div className="grid grid-cols-3 gap-2">
        <label className="block">
          <span className={labelClass}>Airline</span>
          <input
            type="text"
            placeholder="Kenya Airways"
            value={editor.providerName}
            onChange={(e) => patch({ providerName: e.target.value })}
            className={fieldClass}
          />
        </label>
        <label className="block">
          <span className={`${labelClass} text-sky-700`}>{arrival ? 'Arrival airport' : 'Departure airport'}</span>
          <AirportInput
            value={editor.details[hereKey] ?? ''}
            onChange={(value) => setDetail(hereKey, value)}
            onPick={(airport) => pickAirport(hereKey, airport)}
            placeholder="NBO or Nairobi"
            className="ring-1 ring-sky-100"
          />
        </label>
        <label className="block">
          <span className={labelClass}>{arrival ? 'Arriving from' : 'Flying to'}</span>
          <AirportInput
            value={editor.details[thereKey] ?? ''}
            onChange={(value) => setDetail(thereKey, value)}
            onPick={(airport) => pickAirport(thereKey, airport)}
            placeholder="LHR or London"
          />
        </label>
      </div>

      <label className="block">
        <span className={labelClass}>Title</span>
        <input
          type="text"
          placeholder={arrival ? 'Meet the principal at arrivals' : 'See the principal off'}
          value={editor.description}
          onChange={(e) => patch({ description: e.target.value })}
          className="mt-1 w-full rounded-lg bg-gray-50 px-4 py-3 text-base font-medium focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <span className="mt-1 block text-[11px] text-gray-400">
          Leave blank to use “{arrival ? 'Arrival' : 'Departure'}{editor.details.flightNumber ? ` · ${editor.details.flightNumber}` : ''}”.
        </span>
      </label>

      {/* Airport arrival or departure assistance, lounge access… */}
      <ServicePicker editor={editor} patch={patch} showCost={showCost} tripCountry={tripCountry} />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="block">
          <span className={labelClass}>Day</span>
          <select
            value={editor.dayId == null ? '' : String(editor.dayId)}
            onChange={(e) => {
              const dayId = e.target.value ? Number(e.target.value) : null;
              const day = days.find((d) => d.id === dayId);
              patch({ dayId, date: day?.dateKey ?? editor.date });
            }}
            className={fieldClass}
          >
            <option value="">Unscheduled</option>
            {days.map((day) => (
              <option key={day.id} value={day.id}>
                Day {day.dayNumber}
                {day.dateKey ? ` · ${dayLabel(day).short}` : ''}
                {day.title ? ` — ${day.title}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>Date</span>
          <input
            type="date"
            value={editor.date}
            onChange={(e) => {
              const date = e.target.value;
              const day = days.find((d) => d.dateKey === date);
              patch({ date, dayId: day ? day.id : editor.dayId });
            }}
            className={fieldClass}
          />
          {weekday && <span className="mt-1 block text-[11px] text-gray-400">{weekday}</span>}
        </label>
        <label className="block">
          <span className={`${labelClass} text-sky-700`}>{arrival ? 'Arrival time' : 'Departure time'}</span>
          <input
            type="time"
            value={editor.time}
            onChange={(e) => patch({ time: e.target.value })}
            disabled={!editor.date}
            className={`${fieldClass} disabled:opacity-50`}
          />
          <span className="mt-1 block text-[11px] text-gray-400">Local at the {arrival ? 'arrival' : 'departure'} airport</span>
        </label>
        <label className="block">
          <span className={labelClass}>Timezone</span>
          <select
            value={editor.timezone}
            onChange={(e) => patch({ timezone: e.target.value })}
            className={fieldClass}
          >
            <optgroup label="Common">
              {zoneOptions.common.map(({ zone, label }) => (
                <option key={zone} value={zone}>
                  {label}
                </option>
              ))}
            </optgroup>
            <optgroup label="All time zones">
              {zoneOptions.rest.map(({ zone, label }) => (
                <option key={zone} value={zone}>
                  {label}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="block w-24">
          <span className={labelClass}>Duration</span>
          <div className="relative">
            <input
              type="number"
              min="0"
              max="30"
              inputMode="numeric"
              value={editor.durationHours}
              onChange={(e) => patch({ durationHours: e.target.value })}
              className={`${fieldClass} pr-7`}
            />
            <span className="pointer-events-none absolute right-3 top-1/2 mt-0.5 -translate-y-1/2 text-xs text-gray-400">h</span>
          </div>
        </label>
        <label className="block w-24">
          <span className="sr-only">Minutes</span>
          <div className="relative">
            <input
              type="number"
              min="0"
              max="59"
              step="5"
              inputMode="numeric"
              value={editor.durationMinutes}
              onChange={(e) => patch({ durationMinutes: e.target.value })}
              className={`${fieldClass} pr-9`}
            />
            <span className="pointer-events-none absolute right-3 top-1/2 mt-0.5 -translate-y-1/2 text-xs text-gray-400">min</span>
          </div>
        </label>
      </div>

      {/* Who meets them at arrivals, or takes them to departures. */}
      <CrewFields
        options={crewOptions}
        driverId={editor.driverId}
        officerId={editor.officerId}
        vehicleId={editor.vehicleId}
        onChange={patch}
      />

      <label className="block">
        <span className={labelClass}>Notes</span>
        <textarea
          placeholder={arrival ? 'Meeting point, vehicle, who is greeting them…' : 'Drop-off time, check-in, lounge…'}
          value={editor.body}
          onChange={(e) => patch({ body: e.target.value })}
          rows={3}
          className={fieldClass}
        />
      </label>

      <details className="rounded-xl border border-gray-100 px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-gray-500">
          More — seat, gate, baggage, confirmation{showCost ? ', cost' : ''}, reminder
        </summary>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <label className="block">
            <span className={labelClass}>Cabin</span>
            <select value={editor.details.cabin ?? ''} onChange={(e) => setDetail('cabin', e.target.value)} className={fieldClass}>
              <option value="">—</option>
              {CABINS.map((cabin) => (
                <option key={cabin} value={cabin}>
                  {cabin}
                </option>
              ))}
            </select>
          </label>
          {(
            [
              ['seat', 'Seat', '14A'],
              ['terminal', 'Terminal', '1A'],
              ['gate', 'Gate', '12'],
              ['baggage', 'Baggage', '2 × 23kg'],
            ] as const
          ).map(([key, label, placeholder]) => (
            <label key={key} className="block">
              <span className={labelClass}>{label}</span>
              <input
                type="text"
                placeholder={placeholder}
                value={editor.details[key] ?? ''}
                onChange={(e) => setDetail(key, e.target.value)}
                className={fieldClass}
              />
            </label>
          ))}
          <label className="block">
            <span className={labelClass}>Confirmation #</span>
            <input
              type="text"
              value={editor.confirmationCode}
              onChange={(e) => patch({ confirmationCode: e.target.value })}
              className={fieldClass}
            />
          </label>
          <label className="block">
            <span className={labelClass}>Reminder</span>
            <select
              value={editor.reminderMinutesBefore}
              onChange={(e) => patch({ reminderMinutesBefore: e.target.value })}
              disabled={!editor.date}
              className={`${fieldClass} disabled:opacity-50`}
            >
              {REMINDER_OPTIONS.map((option) => (
                <option key={String(option.value)} value={option.value == null ? '' : String(option.value)}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {showCost && (
            <label className="block">
              <span className={labelClass}>Cost</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={editor.unitPrice}
                onChange={(e) => patch({ unitPrice: e.target.value })}
                className={fieldClass}
              />
            </label>
          )}
        </div>
      </details>
    </div>
  );
}
