import type { TripItineraryItemSummary } from '../../types';

/** Driver, vehicle and Close Protection Officer on a card, each with what you'd need on the day. */
export function CrewRow({ item }: { item: TripItineraryItemSummary }) {
  const { driver, vehicle, officer } = item;
  if (!driver && !vehicle && !officer) return null;

  const cell = (label: string, primary: string, secondary: string | null, phone?: string | null) => (
    <div className="min-w-0">
      <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">{label}</p>
      <p className="truncate text-sm font-semibold text-slate-800">{primary}</p>
      {phone ? (
        <a href={`tel:${phone}`} className="block truncate text-xs text-primary hover:underline">
          {phone}
        </a>
      ) : (
        secondary && <p className="truncate text-xs text-slate-500">{secondary}</p>
      )}
    </div>
  );

  return (
    <div className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2 rounded-xl bg-slate-50 px-3 py-2.5 sm:grid-cols-3">
      {driver && cell('Driver', driver.name, null, driver.phone)}
      {vehicle &&
        cell('Vehicle', vehicle.registration, [vehicle.make, vehicle.model].filter(Boolean).join(' ') || vehicle.type)}
      {officer &&
        cell('Close Protection Officer', officer.name, [officer.grade, officer.callSign].filter(Boolean).join(' · '), officer.phone)}
    </div>
  );
}
