import 'server-only';

import { prisma } from './prisma';
import { ACTIVE_ASSIGNMENT_STATUSES } from './task-assignment';

/** One driver, CPO or vehicle as the itinerary's crew pickers offer it. */
export interface CrewOption {
  id: number;
  /** Name, or registration for a vehicle. */
  label: string;
  /** Phone, grade and call sign, or make and model. */
  hint: string | null;
  status: string;
  /** Allocated to this trip in Task Assignment: offered first. */
  onTrip: boolean;
  /** Reference of another trip it's actively assigned to, as a heads-up. */
  busyOn: string | null;
}

export interface CrewOptions {
  drivers: CrewOption[];
  officers: CrewOption[];
  vehicles: CrewOption[];
}

function join(...parts: Array<string | null | undefined>): string | null {
  const text = parts.filter(Boolean).join(' · ');
  return text || null;
}

/**
 * Task Assignment's registers for picking an event's crew. Nothing is
 * blocked here: being busy elsewhere is shown, not enforced, because the
 * register's "busy" isn't time-aware and one person often works several
 * movements of the same trip.
 */
export async function listCrewOptions(tripId: number): Promise<CrewOptions> {
  const [drivers, officers, vehicles, assignments] = await Promise.all([
    prisma.driver.findMany({
      where: { retiredAt: null },
      select: { id: true, name: true, phone: true, status: true },
      orderBy: [{ name: 'asc' }],
    }),
    prisma.officer.findMany({
      where: { retiredAt: null },
      select: { id: true, name: true, callSign: true, grade: true, phone: true, status: true },
      orderBy: [{ name: 'asc' }],
    }),
    prisma.vehicle.findMany({
      select: { id: true, registration: true, make: true, model: true, type: true, status: true },
      orderBy: [{ registration: 'asc' }],
    }),
    prisma.tripAssignment.findMany({
      where: {
        OR: [
          { tripId, status: { not: 'Cancelled' } },
          { tripId: { not: tripId }, status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } },
        ],
      },
      select: { tripId: true, driverId: true, officerId: true, vehicleId: true, trip: { select: { reference: true } } },
    }),
  ]);

  const onTrip = { driver: new Set<number>(), officer: new Set<number>(), vehicle: new Set<number>() };
  const busy = { driver: new Map<number, string>(), officer: new Map<number, string>(), vehicle: new Map<number, string>() };
  for (const a of assignments) {
    const here = a.tripId === tripId;
    const mark = (kind: 'driver' | 'officer' | 'vehicle', id: number | null) => {
      if (!id) return;
      if (here) onTrip[kind].add(id);
      else if (!busy[kind].has(id)) busy[kind].set(id, a.trip.reference);
    };
    mark('driver', a.driverId);
    mark('officer', a.officerId);
    mark('vehicle', a.vehicleId);
  }

  return {
    drivers: drivers.map((d) => ({
      id: d.id,
      label: d.name,
      hint: d.phone,
      status: d.status,
      onTrip: onTrip.driver.has(d.id),
      busyOn: busy.driver.get(d.id) ?? null,
    })),
    officers: officers.map((o) => ({
      id: o.id,
      label: o.name,
      hint: join(o.grade, o.callSign, o.phone),
      status: o.status,
      onTrip: onTrip.officer.has(o.id),
      busyOn: busy.officer.get(o.id) ?? null,
    })),
    vehicles: vehicles.map((v) => ({
      id: v.id,
      label: v.registration,
      hint: join([v.make, v.model].filter(Boolean).join(' ') || null, v.type),
      status: v.status,
      onTrip: onTrip.vehicle.has(v.id),
      busyOn: busy.vehicle.get(v.id) ?? null,
    })),
  };
}
