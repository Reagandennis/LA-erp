import { Plane, Navigation, CalendarDays, Key, MapPin } from 'lucide-react';
import { FlightRecord } from './FlightTable';

type FlightDetailCardProps = {
  flight: FlightRecord | null;
};

export function FlightDetailCard({ flight }: FlightDetailCardProps) {
  if (!flight) {
    return (
      <div className="flex h-full min-h-[300px] w-full items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-slate-500">
        <p className="text-sm">Select a flight from the list to view details</p>
      </div>
    );
  }

  // Calculate mock progress based on status since light API doesn't provide ETA
  let progress = 0;
  let isAnimating = false;
  
  if (flight.status === 'Landed') {
    progress = 100;
  } else if (flight.status === 'Airborne' || flight.status === 'Tracking') {
    progress = 50; // default to middle for airborne
    isAnimating = true; // add pulse/move effect
  }

  return (
    <div className="flex w-full flex-col gap-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold text-slate-900">{flight.flightNumber || flight.callsign}</h2>
            {flight.airline && (
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                {flight.airline}
              </span>
            )}
          </div>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
            <Plane className="h-4 w-4" />
            {flight.aircraftType || 'Aircraft Type Unknown'}
          </p>
        </div>
        <span
          className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-semibold ${
            flight.status === 'Airborne' || flight.status === 'Tracking'
              ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
              : flight.status === 'Landed'
              ? 'bg-slate-100 text-slate-700 border-slate-200'
              : 'bg-amber-100 text-amber-700 border-amber-200'
          }`}
        >
          {flight.status}
        </span>
      </div>

      {/* Progress Animation */}
      <div className="my-4">
        <div className="flex justify-between mb-2 text-sm font-semibold text-slate-600">
          <div className="flex items-center gap-1"><MapPin className="h-4 w-4" /> {flight.origin.iata || flight.origin.icao || 'Origin'}</div>
          <div className="flex items-center gap-1"><MapPin className="h-4 w-4" /> {flight.destination.iata || flight.destination.icao || 'Dest'}</div>
        </div>
        <div className="relative h-2 w-full rounded-full bg-slate-100">
          <div 
            className="absolute top-0 left-0 h-full rounded-full bg-sky-500 transition-all duration-1000 ease-in-out" 
            style={{ width: `${progress}%` }}
          />
          <div 
            className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 text-sky-500 transition-all duration-1000 ease-in-out ${isAnimating ? 'animate-pulse' : ''}`}
            style={{ left: `${progress}%` }}
          >
            <Plane className="h-6 w-6 fill-current" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-100">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase text-slate-400 flex items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5" /> Departure
          </p>
          <p className="text-sm font-medium text-slate-900">
            {flight.times.takeoff ? new Date(flight.times.takeoff).toLocaleString() : 'Pending / Unknown'}
          </p>
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold uppercase text-slate-400 flex items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5" /> Arrival
          </p>
          <p className="text-sm font-medium text-slate-900">
            {flight.times.landed ? new Date(flight.times.landed).toLocaleString() : 'Pending / Unknown'}
          </p>
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold uppercase text-slate-400 flex items-center gap-1.5">
            <Navigation className="h-3.5 w-3.5" /> Callsign
          </p>
          <p className="text-sm font-medium text-slate-900">{flight.callsign || 'N/A'}</p>
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold uppercase text-slate-400 flex items-center gap-1.5">
            <Key className="h-3.5 w-3.5" /> Registration
          </p>
          <p className="text-sm font-medium text-slate-900">{flight.registration || 'N/A'}</p>
        </div>
      </div>
    </div>
  );
}
