'use client';

import { APP_LOCALE } from '@/lib/locale';
import { weekdayOf } from '@/lib/zoned-time';

import { REMINDER_OPTIONS, type CrewOptions, type TripDaySummary } from '../../types';
import { CATEGORY_META } from '../categories';
import type { EditorState } from '../editor-state';
import { EMPTY_RUN, emptyRunTitle } from '../empty-run';
import { dayLabel } from '../itinerary-model';
import { CrewFields } from './crew-fields';
import ServicePicker from './service-picker';

const TYPES = CATEGORY_META.transportation.fields.find((field) => field.key === 'mode')?.options ?? [];

type Kind = 'PICK-UP' | 'DROP-OFF' | typeof EMPTY_RUN;

/** "Arrives 06:30", or "Arrives 00:15 on Tuesday" past midnight. */
function arrivalHint(date: string, time: string, minutes: number): string | null {
  if (!date || !time || minutes <= 0) return null;
  const start = new Date(`${date}T${time}:00`);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start.getTime() + minutes * 60_000);
  const clock = end.toLocaleTimeString(APP_LOCALE, { hour: '2-digit', minute: '2-digit', hour12: false });
  return end.toDateString() === start.toDateString()
    ? `Arrives ${clock}`
    : `Arrives ${clock} on ${end.toLocaleDateString(APP_LOCALE, { weekday: 'long' })}`;
}

/**
 * The transport form. Pick-up, drop-off or empty run is chosen first, and
 * the place and time fields take their meaning from it; then the service it
 * sells, from Products & Services, and the crew from Task Assignment. An
 * empty run is the vehicle moving with no passenger, so it sells nothing.
 */
export default function TransportFields({
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
  const dropOff = editor.timeLabel === 'DROP-OFF';
  const emptyRun = editor.timeLabel === EMPTY_RUN;
  const labelClass = 'text-xs font-medium text-gray-500';
  const fieldClass =
    'mt-1 w-full rounded-lg bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30';
  const setDetail = (key: string, value: string) => patch({ details: { ...editor.details, [key]: value } });

  // Where this movement happens, and the other end of it.
  const hereKey = dropOff ? 'dropoffLocation' : 'pickupLocation';
  const thereKey = dropOff ? 'pickupLocation' : 'dropoffLocation';

  const switchKind = (next: Kind) => {
    if (next === editor.timeLabel) return;
    // An empty run reads the same two places as From → To; no swap needed.
    if (next === EMPTY_RUN || emptyRun) {
      patch({ timeLabel: next });
      return;
    }
    // What was typed as "this" place stays this place under the new label.
    patch({
      timeLabel: next,
      details: {
        ...editor.details,
        pickupLocation: editor.details.dropoffLocation ?? '',
        dropoffLocation: editor.details.pickupLocation ?? '',
      },
    });
  };

  const weekday = weekdayOf(editor.date, APP_LOCALE);
  const driveMinutes = (Number(editor.durationHours) || 0) * 60 + (Number(editor.durationMinutes) || 0);
  const arrives = emptyRun ? arrivalHint(editor.date, editor.time, driveMinutes) : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-gray-100 p-1">
        {(
          [
            ['PICK-UP', 'Pick-up', 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 010-5 2.5 2.5 0 010 5z'],
            ['DROP-OFF', 'Drop-off', 'M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6z'],
            [EMPTY_RUN, 'Empty run', 'M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8a1 1 0 001 1h1a1 1 0 001-1v-1h12v1a1 1 0 001 1h1a1 1 0 001-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z'],
          ] as const
        ).map(([value, label, icon]) => (
          <button
            key={value}
            type="button"
            onClick={() => switchKind(value)}
            aria-pressed={editor.timeLabel === value}
            className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-2.5 text-sm font-semibold transition sm:gap-2 sm:px-3 ${
              editor.timeLabel === value
                ? `bg-white shadow-sm ${value === EMPTY_RUN ? 'text-slate-700' : 'text-primary'}`
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
              <path d={icon} />
            </svg>
            {label}
          </button>
        ))}
      </div>

      {emptyRun && (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          No passengers: the driver and vehicle repositioning, out to a pick-up or back after a drop-off.
        </p>
      )}

      {!emptyRun && (
        <div className="space-y-2">
          <ServicePicker editor={editor} patch={patch} showCost={showCost} tripCountry={tripCountry} />
          <label className="block sm:w-1/2">
            <span className={labelClass}>Type</span>
            <select value={editor.details.mode ?? ''} onChange={(e) => setDetail('mode', e.target.value)} className={fieldClass}>
              <option value="">—</option>
              {editor.details.mode && !TYPES.includes(editor.details.mode) && (
                <option value={editor.details.mode}>{editor.details.mode}</option>
              )}
              {TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <label className="block">
        <span className={labelClass}>Title</span>
        <input
          type="text"
          placeholder={emptyRun ? 'Position to the airport' : dropOff ? 'Drop-off at the hotel' : 'Airport pick-up'}
          value={editor.description}
          onChange={(e) => patch({ description: e.target.value })}
          className="mt-1 w-full rounded-lg bg-gray-50 px-4 py-3 text-base font-medium focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <span className="mt-1 block text-[11px] text-gray-400">
          Leave blank to use “
          {emptyRun
            ? emptyRunTitle(editor.details.pickupLocation ?? '', editor.details.dropoffLocation ?? '')
            : `${dropOff ? 'Drop-off' : 'Pick-up'}${editor.details[hereKey] ? ` · ${editor.details[hereKey]}` : ''}`}
          ”.
        </span>
      </label>

      {emptyRun ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="block">
            <span className={labelClass}>From</span>
            <input
              type="text"
              placeholder="Base / yard"
              value={editor.details.pickupLocation ?? ''}
              onChange={(e) => setDetail('pickupLocation', e.target.value)}
              className={fieldClass}
            />
          </label>
          <label className="block">
            <span className={labelClass}>To</span>
            <input
              type="text"
              placeholder="JKIA Terminal 1A"
              value={editor.details.dropoffLocation ?? ''}
              onChange={(e) => setDetail('dropoffLocation', e.target.value)}
              className={fieldClass}
            />
          </label>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="block">
            <span className={`${labelClass} text-primary`}>{dropOff ? 'Drop-off location' : 'Pick-up location'}</span>
            <input
              type="text"
              placeholder={dropOff ? 'Villa Rosa Kempinski' : 'JKIA Terminal 1A arrivals'}
              value={editor.details[hereKey] ?? ''}
              onChange={(e) => setDetail(hereKey, e.target.value)}
              className={`${fieldClass} ring-1 ring-primary/10`}
            />
          </label>
          <label className="block">
            <span className={labelClass}>{dropOff ? 'Coming from' : 'Going to'}</span>
            <input
              type="text"
              value={editor.details[thereKey] ?? ''}
              onChange={(e) => setDetail(thereKey, e.target.value)}
              className={fieldClass}
            />
          </label>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
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
          <span className={`${labelClass} text-primary`}>
            {emptyRun ? 'Departs' : dropOff ? 'Drop-off time' : 'Pick-up time'}
          </span>
          <input
            type="time"
            value={editor.time}
            onChange={(e) => patch({ time: e.target.value })}
            disabled={!editor.date}
            className={`${fieldClass} disabled:opacity-50`}
          />
        </label>
      </div>

      {emptyRun && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block w-24">
            <span className={labelClass}>Drive time</span>
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
          <label className="block w-28">
            <span className={labelClass}>Distance</span>
            <div className="relative">
              <input
                type="number"
                min="0"
                step="0.1"
                inputMode="decimal"
                value={editor.details.distanceKm ?? ''}
                onChange={(e) => setDetail('distanceKm', e.target.value)}
                className={`${fieldClass} pr-9`}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 mt-0.5 -translate-y-1/2 text-xs text-gray-400">km</span>
            </div>
          </label>
          {arrives && <p className="pb-2 text-xs font-medium text-slate-600">{arrives}</p>}
        </div>
      )}

      <CrewFields
        options={crewOptions}
        driverId={editor.driverId}
        officerId={editor.officerId}
        vehicleId={editor.vehicleId}
        onChange={patch}
        legacyDriver={editor.details.driverName || undefined}
        legacyVehicle={editor.details.vehicle || undefined}
      />

      <label className="block">
        <span className={labelClass}>Notes</span>
        <textarea
          placeholder={
            emptyRun
              ? 'Fuel stop, keys, where to wait…'
              : dropOff
                ? 'Luggage, who receives them, gate codes…'
                : 'Name board, meeting point, flight to watch…'
          }
          value={editor.body}
          onChange={(e) => patch({ body: e.target.value })}
          rows={3}
          className={fieldClass}
        />
      </label>

      <details className="rounded-xl border border-gray-100 px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-gray-500">
          More — company, contact, confirmation{showCost ? ', cost' : ''}, reminder
        </summary>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <label className="block">
            <span className={labelClass}>Company</span>
            <input
              type="text"
              value={editor.providerName}
              onChange={(e) => patch({ providerName: e.target.value })}
              className={fieldClass}
            />
          </label>
          <label className="block">
            <span className={labelClass}>Phone</span>
            <input type="tel" value={editor.phone} onChange={(e) => patch({ phone: e.target.value })} className={fieldClass} />
          </label>
          <label className="block">
            <span className={labelClass}>Confirmation #</span>
            <input
              type="text"
              value={editor.confirmationCode}
              onChange={(e) => patch({ confirmationCode: e.target.value })}
              className={fieldClass}
            />
          </label>
          <label className="col-span-2 block">
            <span className={labelClass}>Booking link</span>
            <input
              type="url"
              value={editor.bookingUrl}
              onChange={(e) => patch({ bookingUrl: e.target.value })}
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
