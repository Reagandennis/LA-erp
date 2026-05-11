import { PlaneTakeoff, PlaneLanding, Clock, MapPin } from 'lucide-react';

export type FlightRecord = {
  id: string;
  flightNumber: string;
  callsign: string | null;
  airline: string | null;
  aircraftType: string | null;
  registration: string | null;
  status: 'Scheduled' | 'Tracking' | 'Airborne' | 'Landed';
  origin: { iata: string | null; icao: string | null };
  destination: { iata: string | null; icao: string | null };
  times: { takeoff: string | null; landed: string | null; firstSeen: string | null; lastSeen: string | null };
};

type FlightTableProps = {
  flights: FlightRecord[];
  isLoading: boolean;
  onSelectFlight: (flight: FlightRecord) => void;
  selectedFlightId: string | null;
};

const getStatusColor = (status: FlightRecord['status']) => {
  switch (status) {
    case 'Airborne':
    case 'Tracking':
      return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    case 'Landed':
      return 'bg-slate-100 text-slate-700 border-slate-200';
    case 'Scheduled':
      return 'bg-amber-100 text-amber-700 border-amber-200';
    default:
      return 'bg-sky-100 text-sky-700 border-sky-200';
  }
};

const formatTime = (timeString: string | null) => {
  if (!timeString) return '—';
  try {
    const d = new Date(timeString);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return '—';
  }
};

export function FlightTable({ flights, isLoading, onSelectFlight, selectedFlightId }: FlightTableProps) {
  if (isLoading && flights.length === 0) {
    return (
      <div className="flex h-48 w-full items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
        Searching for flights...
      </div>
    );
  }

  if (!isLoading && flights.length === 0) {
    return (
      <div className="flex h-48 w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-slate-500">
        <PlaneTakeoff className="h-8 w-8 opacity-20" />
        <p className="text-sm">No flights found. Try adjusting your search.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-slate-100 bg-slate-50/50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-6 py-4 font-semibold">Flight</th>
              <th className="px-6 py-4 font-semibold">Route</th>
              <th className="px-6 py-4 font-semibold">Departure</th>
              <th className="px-6 py-4 font-semibold">Arrival</th>
              <th className="px-6 py-4 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {flights.map((flight) => (
              <tr
                key={flight.id}
                onClick={() => onSelectFlight(flight)}
                className={`cursor-pointer transition-colors hover:bg-slate-50/80 ${
                  selectedFlightId === flight.id ? 'bg-sky-50/50 hover:bg-sky-50' : ''
                }`}
              >
                <td className="px-6 py-4">
                  <div className="flex flex-col">
                    <span className="font-semibold text-slate-900">{flight.flightNumber || flight.callsign || 'Unknown'}</span>
                    {flight.airline && <span className="text-xs text-slate-500">{flight.airline}</span>}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2 text-slate-600">
                    <span className="font-medium">{flight.origin.iata || flight.origin.icao || 'N/A'}</span>
                    <PlaneTakeoff className="h-3 w-3 opacity-50" />
                    <span className="font-medium">{flight.destination.iata || flight.destination.icao || 'N/A'}</span>
                  </div>
                </td>
                <td className="px-6 py-4 text-slate-600">
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 opacity-50" />
                    {formatTime(flight.times.takeoff || flight.times.firstSeen)}
                  </div>
                </td>
                <td className="px-6 py-4 text-slate-600">
                  <div className="flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 opacity-50" />
                    {formatTime(flight.times.landed || flight.times.lastSeen)}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${getStatusColor(
                      flight.status
                    )}`}
                  >
                    {flight.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
