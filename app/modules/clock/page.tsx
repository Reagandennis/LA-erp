'use client';

import { useEffect, useMemo, useState } from 'react';

type ClockZone = {
  id: string;
  label: string;
  timezone: string;
  primary?: boolean;
};

const TIMEZONE_OPTIONS: ClockZone[] = [
  { id: 'nairobi', label: 'Nairobi', timezone: 'Africa/Nairobi', primary: true },
  { id: 'lagos', label: 'Lagos', timezone: 'Africa/Lagos' },
  { id: 'johannesburg', label: 'Johannesburg', timezone: 'Africa/Johannesburg' },
  { id: 'london', label: 'London', timezone: 'Europe/London' },
  { id: 'paris', label: 'Paris', timezone: 'Europe/Paris' },
  { id: 'new-york', label: 'New York', timezone: 'America/New_York' },
  { id: 'toronto', label: 'Toronto', timezone: 'America/Toronto' },
  { id: 'dubai', label: 'Dubai', timezone: 'Asia/Dubai' },
  { id: 'singapore', label: 'Singapore', timezone: 'Asia/Singapore' },
  { id: 'tokyo', label: 'Tokyo', timezone: 'Asia/Tokyo' },
  { id: 'sydney', label: 'Sydney', timezone: 'Australia/Sydney' },
];

const PRIMARY_ZONE = TIMEZONE_OPTIONS[0];

const formatTime = (date: Date, timezone: string) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);

const formatDate = (date: Date, timezone: string) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date);

const formatOffset = (date: Date, timezone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'shortOffset',
    hour: '2-digit',
  }).formatToParts(date);
  const offsetPart = parts.find((part) => part.type === 'timeZoneName');
  return offsetPart?.value ?? '';
};

export default function ClockPage() {
  const [now, setNow] = useState(() => new Date());
  const [selectedZoneId, setSelectedZoneId] = useState(TIMEZONE_OPTIONS[1].id);
  const [zones, setZones] = useState<ClockZone[]>([PRIMARY_ZONE, TIMEZONE_OPTIONS[1], TIMEZONE_OPTIONS[3]]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const availableZones = useMemo(
    () => TIMEZONE_OPTIONS.filter((option) => !zones.some((zone) => zone.id === option.id)),
    [zones],
  );

  const addZone = () => {
    const option = TIMEZONE_OPTIONS.find((entry) => entry.id === selectedZoneId);
    if (!option || zones.some((zone) => zone.id === option.id)) {
      return;
    }
    setZones((current) => [...current, option]);
  };

  const removeZone = (zoneId: string) => {
    setZones((current) => current.filter((zone) => zone.id !== zoneId || zone.primary));
  };

  return (
    <div className="min-h-screen bg-gray-50 px-6 py-10">
      <div className="mx-auto max-w-6xl space-y-8">
        <header className="flex flex-col gap-3">
          <span className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-600">Time hub</span>
          <h1 className="text-3xl font-semibold text-gray-900">World clocks</h1>
          <p className="max-w-2xl text-base text-gray-600">
            Keep every team in sync with live clocks. Nairobi is your primary time zone, with additional locations you
            can add or remove as needed.
          </p>
        </header>

        <section className="rounded-3xl border border-emerald-100 bg-linear-to-br from-emerald-50 via-white to-white p-6 shadow-sm">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold text-emerald-700">Primary time zone</p>
              <h2 className="text-2xl font-semibold text-gray-900">{PRIMARY_ZONE.label}</h2>
              <p className="text-sm text-gray-500">{PRIMARY_ZONE.timezone}</p>
            </div>
            <div className="rounded-2xl bg-white px-6 py-4 shadow">
              <p className="text-sm text-gray-500">{formatDate(now, PRIMARY_ZONE.timezone)}</p>
              <p className="text-3xl font-semibold text-gray-900">{formatTime(now, PRIMARY_ZONE.timezone)}</p>
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-600">
                {formatOffset(now, PRIMARY_ZONE.timezone)}
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Add a clock</h3>
              <p className="text-sm text-gray-500">Pick another time zone to monitor.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <select
                value={selectedZoneId}
                onChange={(event) => setSelectedZoneId(event.target.value)}
                className="min-w-55 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700"
              >
                {availableZones.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label} ({option.timezone})
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={addZone}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                Add clock
              </button>
            </div>
          </div>
        </section>

        <section className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {zones.map((zone) => (
            <div
              key={zone.id}
              className={`rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md ${
                zone.primary ? 'ring-1 ring-emerald-200' : ''
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">
                    {zone.primary ? 'Primary' : 'Local time'}
                  </p>
                  <h4 className="text-lg font-semibold text-gray-900">{zone.label}</h4>
                  <p className="text-xs text-gray-500">{zone.timezone}</p>
                </div>
                {!zone.primary && (
                  <button
                    type="button"
                    onClick={() => removeZone(zone.id)}
                    className="text-xs font-semibold text-rose-500 hover:text-rose-600"
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="mt-4 space-y-1">
                <p className="text-sm text-gray-500">{formatDate(now, zone.timezone)}</p>
                <p className="text-2xl font-semibold text-gray-900">{formatTime(now, zone.timezone)}</p>
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                  {formatOffset(now, zone.timezone)}
                </p>
              </div>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
