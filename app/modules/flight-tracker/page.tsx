'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type FlightState = {
  icao24: string;
  callsign: string | null;
  originCountry: string;
  timePosition: number | null;
  lastContact: number;
  longitude: number | null;
  latitude: number | null;
  baroAltitude: number | null;
  onGround: boolean;
  velocity: number | null;
  trueTrack: number | null;
  verticalRate: number | null;
};

type Bounds = {
  lamin: string;
  lomin: string;
  lamax: string;
  lomax: string;
};

const DEFAULT_BOUNDS: Bounds = {
  lamin: '-4.9',
  lomin: '33.9',
  lamax: '5.2',
  lomax: '41.9',
};

const parseState = (raw: unknown[]): FlightState => ({
  icao24: typeof raw[0] === 'string' ? raw[0] : '',
  callsign: typeof raw[1] === 'string' ? raw[1].trim() : null,
  originCountry: typeof raw[2] === 'string' ? raw[2] : '',
  timePosition: typeof raw[3] === 'number' ? raw[3] : null,
  lastContact: typeof raw[4] === 'number' ? raw[4] : 0,
  longitude: typeof raw[5] === 'number' ? raw[5] : null,
  latitude: typeof raw[6] === 'number' ? raw[6] : null,
  baroAltitude: typeof raw[7] === 'number' ? raw[7] : null,
  onGround: Boolean(raw[8]),
  velocity: typeof raw[9] === 'number' ? raw[9] : null,
  trueTrack: typeof raw[10] === 'number' ? raw[10] : null,
  verticalRate: typeof raw[11] === 'number' ? raw[11] : null,
});

const formatKnots = (metersPerSecond: number | null) =>
  metersPerSecond === null ? '—' : `${Math.round(metersPerSecond * 1.94384)} kt`;

const formatFeet = (meters: number | null) =>
  meters === null ? '—' : `${Math.round(meters * 3.28084)} ft`;

const normalizeSearch = (value: string) => value.toLowerCase().replaceAll(/\s+/g, '');

type FlightStatus = 'Scheduled' | 'On Time' | 'Late' | 'Airborne';

const getFlightStatus = (flight: FlightState): FlightStatus => {
  if (!flight.onGround) {
    return 'Airborne';
  }

  const lastContactAge = Date.now() / 1000 - flight.lastContact;
  if (flight.timePosition === null || lastContactAge > 900) {
    return 'Scheduled';
  }

  return lastContactAge > 300 ? 'Late' : 'On Time';
};

const getStatusStyles = (status: FlightStatus) => {
  switch (status) {
    case 'Late':
      return 'bg-rose-100 text-rose-700';
    case 'Scheduled':
      return 'bg-amber-100 text-amber-700';
    case 'Airborne':
      return 'bg-emerald-100 text-emerald-700';
    default:
      return 'bg-sky-100 text-sky-700';
  }
};

const StatusBadge = ({ flight }: { flight: FlightState }) => {
  const status = getFlightStatus(flight);
  return (
    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${getStatusStyles(status)}`}>
      {status}
    </span>
  );
};

const FeaturedFlightCard = ({ featuredFlight }: { featuredFlight: FlightState | null }) => {
  const status = featuredFlight ? getFlightStatus(featuredFlight) : null;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-50">
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                className={`h-8 w-8 text-sky-600 ${
                  featuredFlight && !featuredFlight.onGround ? 'animate-bounce' : 'animate-pulse'
                }`}
                fill="currentColor"
              >
                <path d="M2.5 13.5l7.6 1.2 4.2 6.5 1.7-.7-2.2-7 5.1.8a1.5 1.5 0 001.7-1.1c.2-.7-.2-1.5-.9-1.8l-5.3-2.1 2.1-6.6-1.7-.7-4.2 6.4-7.7-3.1c-.8-.3-1.7 0-2.1.8a1.6 1.6 0 00.6 2.1l5.5 3.4-3.4 1.7a1 1 0 00.7 1.8l4-1.2z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-500">Selected flight</p>
              <h2 className="text-2xl font-semibold">
                {featuredFlight?.callsign || featuredFlight?.icao24.toUpperCase() || 'No flight selected'}
              </h2>
              <p className="text-sm text-slate-500">
                {featuredFlight ? featuredFlight.originCountry : 'Pick a flight from the list below.'}
              </p>
            </div>
          </div>
          {featuredFlight && status && (
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${getStatusStyles(status)}`}
              >
                {status}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                Altitude: {formatFeet(featuredFlight.baroAltitude)}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                Speed: {formatKnots(featuredFlight.velocity)}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                Track: {featuredFlight.trueTrack === null ? '—' : `${Math.round(featuredFlight.trueTrack)}°`}
              </span>
            </div>
          )}
        </div>

        <div className="grid w-full gap-4 sm:grid-cols-2 lg:max-w-xl">
          <div className="rounded-2xl border border-slate-200 p-4">
            <p className="text-xs font-semibold uppercase text-slate-400">Live position</p>
            <div className="mt-2 text-sm text-slate-700">
              <p>Latitude: {featuredFlight?.latitude?.toFixed(4) ?? '—'}</p>
              <p>Longitude: {featuredFlight?.longitude?.toFixed(4) ?? '—'}</p>
              <p>Vertical rate: {featuredFlight?.verticalRate ?? '—'} m/s</p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 p-4">
            <p className="text-xs font-semibold uppercase text-slate-400">Contact</p>
            <div className="mt-2 text-sm text-slate-700">
              <p>
                Last contact:{' '}
                {featuredFlight
                  ? new Date(featuredFlight.lastContact * 1000).toLocaleTimeString()
                  : '—'}
              </p>
              <p>On ground: {featuredFlight ? (featuredFlight.onGround ? 'Yes' : 'No') : '—'}</p>
              <p>ICAO24: {featuredFlight?.icao24.toUpperCase() ?? '—'}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default function FlightTrackerPage() {
  const [bounds, setBounds] = useState<Bounds>(DEFAULT_BOUNDS);
  const [flights, setFlights] = useState<FlightState[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFlight, setSelectedFlight] = useState<FlightState | null>(null);

  const queryString = useMemo(
    () =>
      `lamin=${bounds.lamin}&lomin=${bounds.lomin}&lamax=${bounds.lamax}&lomax=${bounds.lomax}`,
    [bounds],
  );

  const loadFlights = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/flight-tracker?${queryString}`);
      if (!response.ok) {
        throw new Error('Unable to load flight data');
      }
      const data = (await response.json()) as { states?: unknown[] };
      const next = (data.states ?? []).map((state) => parseState(state as unknown[]));
      setFlights(next);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch {
      setError('Unable to load flight data. Try again.');
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  const filteredFlights = useMemo(() => {
    const query = normalizeSearch(searchQuery.trim());
    if (!query) {
      return flights;
    }

    return flights.filter((flight) => {
      const callsign = normalizeSearch(flight.callsign ?? '');
      const icao = normalizeSearch(flight.icao24);
      const country = normalizeSearch(flight.originCountry);
      return callsign.includes(query) || icao.includes(query) || country.includes(query);
    });
  }, [flights, searchQuery]);

  const featuredFlight = selectedFlight ?? filteredFlights[0] ?? null;

  useEffect(() => {
    void loadFlights();
  }, [loadFlights]);

  return (
    <div className="min-h-screen bg-slate-50 px-6 py-10 text-slate-900">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-col gap-2">
          <span className="text-sm font-semibold uppercase tracking-[0.3em] text-sky-600">Flight tracker</span>
          <h1 className="text-3xl font-semibold">OpenSky live air traffic</h1>
          <p className="max-w-2xl text-sm text-slate-500">
            Powered by the OpenSky Network. Adjust the bounding box to watch live aircraft in your region.
          </p>
        </header>

        <FeaturedFlightCard featuredFlight={featuredFlight} />

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Selected flight details</h2>
              <p className="text-sm text-slate-500">Pick a flight from the list to see a live snapshot.</p>
            </div>
            {selectedFlight ? (
              <div className="grid w-full gap-4 lg:max-w-3xl lg:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 p-4">
                  <p className="text-xs font-semibold uppercase text-slate-400">Flight</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-900">
                    {selectedFlight.callsign || selectedFlight.icao24.toUpperCase()}
                  </p>
                  <p className="text-sm text-slate-500">{selectedFlight.originCountry}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 p-4">
                  <p className="text-xs font-semibold uppercase text-slate-400">Position</p>
                  <p className="mt-2 text-sm font-semibold text-slate-700">
                    {selectedFlight.latitude?.toFixed(2) ?? '—'}, {selectedFlight.longitude?.toFixed(2) ?? '—'}
                  </p>
                  <p className="text-sm text-slate-500">Track: {selectedFlight.trueTrack ?? '—'}°</p>
                </div>
                <div className="rounded-2xl border border-slate-200 p-4">
                  <p className="text-xs font-semibold uppercase text-slate-400">Performance</p>
                  <p className="mt-2 text-sm text-slate-700">Altitude: {formatFeet(selectedFlight.baroAltitude)}</p>
                  <p className="text-sm text-slate-700">Speed: {formatKnots(selectedFlight.velocity)}</p>
                  <p className="text-sm text-slate-700">
                    Vertical rate: {selectedFlight.verticalRate ?? '—'} m/s
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 p-4 lg:col-span-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        selectedFlight.onGround
                          ? 'bg-slate-100 text-slate-600'
                          : 'bg-emerald-100 text-emerald-700'
                      }`}
                    >
                      {selectedFlight.onGround ? 'On ground' : 'Airborne'}
                    </span>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                      ICAO24: {selectedFlight.icao24.toUpperCase()}
                    </span>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                      Last contact: {new Date(selectedFlight.lastContact * 1000).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-5 text-sm text-slate-500">
                No flight selected yet.
              </div>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Tracking area</h2>
              <p className="text-sm text-slate-500">Latitude/longitude bounds.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {(
                [
                  { key: 'lamin', label: 'Lat min' },
                  { key: 'lomin', label: 'Lon min' },
                  { key: 'lamax', label: 'Lat max' },
                  { key: 'lomax', label: 'Lon max' },
                ] as const
              ).map((field) => (
                <label key={field.key} className="text-xs font-semibold text-slate-600">
                  {field.label}
                  <input
                    value={bounds[field.key]}
                    onChange={(event) =>
                      setBounds((current) => ({
                        ...current,
                        [field.key]: event.target.value,
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700"
                  />
                </label>
              ))}
            </div>
            <label className="text-xs font-semibold text-slate-600">
              Search by flight or country
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="AFR990, AF990, France"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700"
              />
            </label>
            <button
              type="button"
              onClick={loadFlights}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700"
            >
              Refresh
            </button>
          </div>
          <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
            <p>Active flights: {filteredFlights.length}</p>
            <p>Last updated: {lastUpdated || '—'}</p>
          </div>
          {error && (
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
              {error}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-400">
                <tr>
                  <th className="px-3 py-2">Callsign</th>
                  <th className="px-3 py-2">Origin</th>
                  <th className="px-3 py-2">Position</th>
                  <th className="px-3 py-2">Altitude</th>
                  <th className="px-3 py-2">Speed</th>
                  <th className="px-3 py-2">Track</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td className="px-3 py-4 text-slate-500" colSpan={7}>
                      Loading flights...
                    </td>
                  </tr>
                ) : flights.length === 0 ? (
                  <tr>
                    <td className="px-3 py-4 text-slate-500" colSpan={7}>
                      No aircraft in this area.
                    </td>
                  </tr>
                ) : (
                  filteredFlights.slice(0, 50).map((flight) => (
                    <tr
                      key={flight.icao24}
                      onClick={() => setSelectedFlight(flight)}
                      className={`cursor-pointer transition hover:bg-slate-50 ${
                        selectedFlight?.icao24 === flight.icao24 ? 'bg-slate-50' : ''
                      }`}
                    >
                      <td className="px-3 py-3 font-semibold">
                        {flight.callsign || flight.icao24.toUpperCase()}
                      </td>
                      <td className="px-3 py-3 text-slate-500">{flight.originCountry}</td>
                      <td className="px-3 py-3 text-slate-500">
                        {flight.latitude?.toFixed(2) ?? '—'}, {flight.longitude?.toFixed(2) ?? '—'}
                      </td>
                      <td className="px-3 py-3 text-slate-500">{formatFeet(flight.baroAltitude)}</td>
                      <td className="px-3 py-3 text-slate-500">{formatKnots(flight.velocity)}</td>
                      <td className="px-3 py-3 text-slate-500">
                        {flight.trueTrack === null ? '—' : `${Math.round(flight.trueTrack)}°`}
                      </td>
                      <td className="px-3 py-3">
                        <StatusBadge flight={flight} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
