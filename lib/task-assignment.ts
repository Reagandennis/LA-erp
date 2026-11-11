import 'server-only';

import { prisma } from '@/lib/prisma';
import {
  conflictsFor,
  dateKeyOf,
  describeConflict,
  type DateWindow,
  type Engagement,
  type ResourceKind as EngagementKind,
} from '@/lib/resource-availability';

// --- Option sets -----------------------------------------------------------

export const VEHICLE_TYPES = ['Sedan', 'SUV', 'Van', 'Truck', 'Armoured', 'Motorcycle'] as const;
/** Our own fleet, or a supplier's. A vehicle nobody has classified yet has neither. */
export const VEHICLE_OWNERSHIPS = ['Internal', 'External'] as const;
export const RESOURCE_STATUSES = ['Available', 'Assigned', 'Maintenance', 'Off duty'] as const;
export const OFFICER_GRADES = ['CPO', 'Team Leader', 'Detail Leader', 'Driver/CPO'] as const;
export const ASSIGNMENT_STATUSES = ['Planned', 'Confirmed', 'Active', 'Completed', 'Cancelled'] as const;
// A resource (car/driver/officer) is considered "busy" while it sits on an
// assignment in one of these statuses. Completed/Cancelled assignments free it.
export const ACTIVE_ASSIGNMENT_STATUSES = ['Planned', 'Confirmed', 'Active'] as const;

/** One resource that cannot take the trip, and the bookings in the way. */
export interface ResourceConflict {
  kind: EngagementKind;
  resourceId: number;
  /** Registration or name, as the pickers show it. */
  label: string;
  message: string;
  conflicts: Engagement[];
}

/**
 * Thrown when a car/driver/officer is already booked on another trip for days
 * this trip needs. Carries the detail so the screen can say who, where and
 * when, and offer the pickers again.
 */
export class ResourceConflictError extends Error {
  constructor(
    message: string,
    public readonly conflicts: ResourceConflict[] = [],
  ) {
    super(message);
    this.name = 'ResourceConflictError';
  }
}

function isActiveStatus(status: string): boolean {
  return (ACTIVE_ASSIGNMENT_STATUSES as readonly string[]).includes(status);
}

export type VehicleType = (typeof VEHICLE_TYPES)[number];
export type VehicleOwnership = (typeof VEHICLE_OWNERSHIPS)[number];
export type ResourceStatus = (typeof RESOURCE_STATUSES)[number];
export type OfficerGrade = (typeof OFFICER_GRADES)[number];
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

function pickStatus(value: unknown): ResourceStatus {
  return (RESOURCE_STATUSES as readonly string[]).includes(value as string)
    ? (value as ResourceStatus)
    : 'Available';
}
function pickOwnership(value: unknown): VehicleOwnership | null {
  return (VEHICLE_OWNERSHIPS as readonly string[]).includes(value as string) ? (value as VehicleOwnership) : null;
}
function pickVehicleType(value: unknown): VehicleType {
  return (VEHICLE_TYPES as readonly string[]).includes(value as string)
    ? (value as VehicleType)
    : 'Sedan';
}
function pickGrade(value: unknown): OfficerGrade {
  return (OFFICER_GRADES as readonly string[]).includes(value as string)
    ? (value as OfficerGrade)
    : 'CPO';
}
function pickAssignmentStatus(value: unknown): AssignmentStatus {
  return (ASSIGNMENT_STATUSES as readonly string[]).includes(value as string)
    ? (value as AssignmentStatus)
    : 'Planned';
}

function trimOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return v.length > 0 ? v : null;
}

// --- Serialized shapes -----------------------------------------------------

export type VehicleSummary = {
  id: number;
  registration: string;
  make: string | null;
  model: string | null;
  type: string;
  status: string;
  capacity: number | null;
  notes: string | null;
  /** Ours or a supplier's; null until someone says. */
  ownership: VehicleOwnership | null;
  /** The vendor profile it is tagged to in Vendors/Suppliers, if any. */
  vendor: { id: number; name: string } | null;
  hasPhoto: boolean;
  createdAt: string;
};

export type DriverSummary = {
  id: number;
  name: string;
  /** Master personnel record, when this resource mirrors one. */
  personnelId: number | null;
  phone: string | null;
  licenseNumber: string | null;
  status: string;
  notes: string | null;
  hasPhoto: boolean;
  createdAt: string;
};

export type OfficerSummary = {
  id: number;
  name: string;
  /** Master personnel record, when this resource mirrors one. */
  personnelId: number | null;
  callSign: string | null;
  grade: string;
  phone: string | null;
  status: string;
  notes: string | null;
  hasPhoto: boolean;
  createdAt: string;
};

/** A trip as the assignment screen names it, with the days it occupies ("YYYY-MM-DD", or null while TBD). */
export type AssignmentTrip = {
  id: number;
  reference: string;
  title: string;
  status: string;
  customerName: string;
  startDate: string | null;
  endDate: string | null;
};

export type AssignmentSummary = {
  id: number;
  tripId: number;
  status: string;
  notes: string | null;
  createdAt: string;
  trip: AssignmentTrip | null;
  vehicle: { id: number; registration: string; type: string } | null;
  driver: { id: number; name: string } | null;
  officer: { id: number; name: string; grade: string } | null;
};

export type TripOption = AssignmentTrip;

export type TaskAssignmentStats = {
  trips: number;
  assignments: number;
  vehiclesAvailable: number;
  driversAvailable: number;
  officersAvailable: number;
};

// --- Selects ---------------------------------------------------------------

const VEHICLE_SELECT = {
  id: true,
  registration: true,
  make: true,
  model: true,
  type: true,
  status: true,
  capacity: true,
  notes: true,
  ownership: true,
  vendor: { select: { id: true, name: true } },
  photoName: true,
  createdAt: true,
} as const;

const DRIVER_SELECT = {
  id: true,
  name: true,
  personnelId: true,
  phone: true,
  licenseNumber: true,
  status: true,
  notes: true,
  photoName: true,
  createdAt: true,
} as const;

const OFFICER_SELECT = {
  id: true,
  name: true,
  personnelId: true,
  callSign: true,
  grade: true,
  phone: true,
  status: true,
  notes: true,
  photoName: true,
  createdAt: true,
} as const;

const TRIP_SELECT = {
  id: true,
  reference: true,
  title: true,
  status: true,
  startDate: true,
  endDate: true,
  customer: { select: { name: true } },
} as const;

const ASSIGNMENT_INCLUDE = {
  trip: { select: TRIP_SELECT },
  vehicle: { select: { id: true, registration: true, type: true } },
  driver: { select: { id: true, name: true } },
  officer: { select: { id: true, name: true, grade: true } },
} as const;

// --- Serializers -----------------------------------------------------------

type VehicleRow = {
  id: number; registration: string; make: string | null; model: string | null;
  type: string; status: string; capacity: number | null; notes: string | null;
  ownership: string | null; vendor: { id: number; name: string } | null;
  photoName: string | null; createdAt: Date;
};
function serializeVehicle(row: VehicleRow): VehicleSummary {
  const { photoName, createdAt, ownership, ...rest } = row;
  return { ...rest, ownership: pickOwnership(ownership), hasPhoto: Boolean(photoName), createdAt: createdAt.toISOString() };
}

type DriverRow = {
  id: number; name: string; phone: string | null; licenseNumber: string | null;
  personnelId: number | null;
  status: string; notes: string | null; photoName: string | null; createdAt: Date;
};
function serializeDriver(row: DriverRow): DriverSummary {
  const { photoName, createdAt, ...rest } = row;
  return { ...rest, hasPhoto: Boolean(photoName), createdAt: createdAt.toISOString() };
}

type OfficerRow = {
  id: number; name: string; callSign: string | null; grade: string;
  personnelId: number | null;
  phone: string | null; status: string; notes: string | null;
  photoName: string | null; createdAt: Date;
};
function serializeOfficer(row: OfficerRow): OfficerSummary {
  const { photoName, createdAt, ...rest } = row;
  return { ...rest, hasPhoto: Boolean(photoName), createdAt: createdAt.toISOString() };
}

type TripRow = {
  id: number; reference: string; title: string; status: string;
  startDate: Date | null; endDate: Date | null; customer: { name: string };
};
function serializeTrip(row: TripRow): AssignmentTrip {
  return {
    id: row.id,
    reference: row.reference,
    title: row.title,
    status: row.status,
    customerName: row.customer.name,
    startDate: dateKeyOf(row.startDate),
    endDate: dateKeyOf(row.endDate),
  };
}

type AssignmentRow = {
  id: number; tripId: number; status: string; notes: string | null; createdAt: Date;
  trip: TripRow | null;
  vehicle: { id: number; registration: string; type: string } | null;
  driver: { id: number; name: string } | null;
  officer: { id: number; name: string; grade: string } | null;
};
function serializeAssignment(row: AssignmentRow): AssignmentSummary {
  return {
    id: row.id,
    tripId: row.tripId,
    status: row.status,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    trip: row.trip ? serializeTrip(row.trip) : null,
    vehicle: row.vehicle,
    driver: row.driver,
    officer: row.officer,
  };
}

// --- Reads -----------------------------------------------------------------

export async function listVehicles(): Promise<VehicleSummary[]> {
  const rows = await prisma.vehicle.findMany({ orderBy: [{ registration: 'asc' }], select: VEHICLE_SELECT });
  return rows.map(serializeVehicle);
}

export async function listDrivers(): Promise<DriverSummary[]> {
  // Retired mirrors are kept so historical assignments never dangle, but they
  // are not offered for new work.
  const rows = await prisma.driver.findMany({
    where: { retiredAt: null },
    orderBy: [{ name: 'asc' }],
    select: DRIVER_SELECT,
  });
  return rows.map(serializeDriver);
}

export async function listOfficers(): Promise<OfficerSummary[]> {
  const rows = await prisma.officer.findMany({
    where: { retiredAt: null },
    orderBy: [{ name: 'asc' }],
    select: OFFICER_SELECT,
  });
  return rows.map(serializeOfficer);
}

export async function listAssignments(): Promise<AssignmentSummary[]> {
  const rows = await prisma.tripAssignment.findMany({
    orderBy: [{ createdAt: 'desc' }],
    include: ASSIGNMENT_INCLUDE,
  });
  return rows.map(serializeAssignment);
}

/** Only the assignments still in play; the screen shows these without a search. */
export async function listCurrentAssignments(): Promise<AssignmentSummary[]> {
  const rows = await prisma.tripAssignment.findMany({
    where: { status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } },
    orderBy: [{ createdAt: 'desc' }],
    include: ASSIGNMENT_INCLUDE,
  });
  return rows.map(serializeAssignment);
}

/** Completed and cancelled assignments (years of them from FileMaker): counted, not shipped. */
export async function countPastAssignments(): Promise<number> {
  return prisma.tripAssignment.count({ where: { status: { notIn: [...ACTIVE_ASSIGNMENT_STATUSES] } } });
}

export const ASSIGNMENT_SEARCH_LIMIT = 100;

/** The database-side search over the whole history, newest first. */
export function buildAssignmentSearchWhere(q: string) {
  const term = q.trim();
  if (!term) return {};
  const contains = { contains: term, mode: 'insensitive' as const };
  return {
    OR: [
      { trip: { reference: contains } },
      { trip: { title: contains } },
      { trip: { customer: { name: contains } } },
      { vehicle: { registration: contains } },
      { driver: { name: contains } },
      { officer: { name: contains } },
    ],
  };
}

export async function searchAssignments(q: string, limit = ASSIGNMENT_SEARCH_LIMIT): Promise<AssignmentSummary[]> {
  const rows = await prisma.tripAssignment.findMany({
    where: buildAssignmentSearchWhere(q),
    orderBy: [{ createdAt: 'desc' }],
    include: ASSIGNMENT_INCLUDE,
    take: Math.max(1, Math.min(limit, ASSIGNMENT_SEARCH_LIMIT)),
  });
  return rows.map(serializeAssignment);
}

export async function listTripOptions(): Promise<TripOption[]> {
  const rows = await prisma.trip.findMany({
    where: { status: { notIn: ['Cancelled', 'Completed'] } },
    orderBy: [{ createdAt: 'desc' }],
    select: TRIP_SELECT,
  });
  return rows.map(serializeTrip);
}

// --- Availability ----------------------------------------------------------

/** Trips in these states no longer hold anyone. */
const CLOSED_TRIP_STATUSES = ['Cancelled', 'Completed'];

/** How far either side of today crewed movements are loaded for the grid. */
export const ENGAGEMENT_WINDOW = { pastDays: 14, futureDays: 120 } as const;

function engagementWindow(now = new Date()): { from: Date; to: Date } {
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - ENGAGEMENT_WINDOW.pastDays);
  from.setUTCHours(0, 0, 0, 0);
  const to = new Date(now);
  to.setUTCDate(to.getUTCDate() + ENGAGEMENT_WINDOW.futureDays);
  to.setUTCHours(23, 59, 59, 999);
  return { from, to };
}

/**
 * Every commitment of every car, driver and officer, from two places:
 *
 *   - Task Assignment allocations in a live status hold the resource for the
 *     whole of the trip's dates (all of them are loaded; there are few);
 *   - crewed itinerary movements hold it for the day of the movement, within
 *     `ENGAGEMENT_WINDOW` of today so years of history stay out of the page.
 *
 * `resources` narrows both to the given ids, for a conflict check. Movements
 * are then loaded without the window: a clash is a clash whenever it is.
 */
export async function listEngagements(options: {
  resources?: Partial<Record<EngagementKind, number[]>>;
  now?: Date;
} = {}): Promise<Engagement[]> {
  const { resources } = options;
  const ids = (kind: EngagementKind) => resources?.[kind] ?? [];
  const narrowed = Boolean(resources);
  const anyOf = (kind: EngagementKind, column: 'vehicleId' | 'driverId' | 'officerId') =>
    ids(kind).length > 0 ? [{ [column]: { in: ids(kind) } }] : [];
  const resourceFilter = narrowed
    ? [...anyOf('vehicle', 'vehicleId'), ...anyOf('driver', 'driverId'), ...anyOf('officer', 'officerId')]
    : null;
  if (resourceFilter && resourceFilter.length === 0) return [];

  const window = engagementWindow(options.now);
  const [assignments, movements] = await Promise.all([
    prisma.tripAssignment.findMany({
      where: {
        status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] },
        trip: { status: { notIn: CLOSED_TRIP_STATUSES } },
        ...(resourceFilter ? { OR: resourceFilter } : {}),
      },
      select: {
        id: true,
        tripId: true,
        status: true,
        vehicleId: true,
        driverId: true,
        officerId: true,
        trip: { select: { reference: true, title: true, startDate: true, endDate: true } },
      },
    }),
    prisma.tripItineraryItem.findMany({
      where: {
        scheduledAt: narrowed ? { not: null } : { gte: window.from, lte: window.to },
        trip: { status: { notIn: CLOSED_TRIP_STATUSES } },
        OR: resourceFilter ?? [{ vehicleId: { not: null } }, { driverId: { not: null } }, { officerId: { not: null } }],
      },
      select: {
        id: true,
        tripId: true,
        scheduledAt: true,
        endsAt: true,
        vehicleId: true,
        driverId: true,
        officerId: true,
        trip: { select: { reference: true, title: true, status: true } },
      },
    }),
  ]);

  const out: Engagement[] = [];
  const push = (base: Omit<Engagement, 'kind' | 'resourceId'>, kind: EngagementKind, resourceId: number | null) => {
    if (!resourceId) return;
    if (narrowed && !ids(kind).includes(resourceId)) return;
    out.push({ ...base, kind, resourceId });
  };

  for (const a of assignments) {
    const base = {
      tripId: a.tripId,
      reference: a.trip.reference,
      title: a.trip.title,
      from: dateKeyOf(a.trip.startDate),
      to: dateKeyOf(a.trip.endDate),
      source: 'assignment' as const,
      assignmentId: a.id,
      itemId: null,
      status: a.status,
    };
    push(base, 'vehicle', a.vehicleId);
    push(base, 'driver', a.driverId);
    push(base, 'officer', a.officerId);
  }
  for (const m of movements) {
    const from = dateKeyOf(m.scheduledAt);
    const base = {
      tripId: m.tripId,
      reference: m.trip.reference,
      title: m.trip.title,
      from,
      to: dateKeyOf(m.endsAt) ?? from,
      source: 'movement' as const,
      assignmentId: null,
      itemId: m.id,
      status: m.trip.status,
    };
    push(base, 'vehicle', m.vehicleId);
    push(base, 'driver', m.driverId);
    push(base, 'officer', m.officerId);
  }
  return out;
}

export function computeStats(args: {
  trips: TripOption[];
  /** The assignments loaded (current ones), plus however many past ones were left behind. */
  assignments: AssignmentSummary[];
  pastAssignments?: number;
  vehicles: VehicleSummary[];
  drivers: DriverSummary[];
  officers: OfficerSummary[];
}): TaskAssignmentStats {
  return {
    trips: args.trips.length,
    assignments: args.assignments.length + (args.pastAssignments ?? 0),
    vehiclesAvailable: args.vehicles.filter((v) => v.status === 'Available').length,
    driversAvailable: args.drivers.filter((d) => d.status === 'Available').length,
    officersAvailable: args.officers.filter((o) => o.status === 'Available').length,
  };
}

// --- Vehicle writes --------------------------------------------------------

export type PhotoInput = { name: string; mime: string; size: number; content: Buffer };

function photoData(photo: PhotoInput | null | undefined) {
  return photo
    ? { photoName: photo.name, photoMime: photo.mime, photoSize: photo.size, photoContent: photo.content }
    : {};
}

export async function createVehicle(input: {
  userId: number;
  registration: string;
  make?: string | null;
  model?: string | null;
  type?: string;
  status?: string;
  capacity?: number | null;
  notes?: string | null;
  /** "Internal" or "External"; left out, the vehicle is unclassified. */
  ownership?: string | null;
  photo?: PhotoInput | null;
}): Promise<VehicleSummary> {
  const registration = input.registration.trim();
  if (!registration) throw new Error('Registration / plate is required');
  const row = await prisma.vehicle.create({
    data: {
      registration,
      make: trimOrNull(input.make),
      model: trimOrNull(input.model),
      type: pickVehicleType(input.type),
      status: pickStatus(input.status),
      capacity: input.capacity && Number.isFinite(input.capacity) ? Math.trunc(input.capacity) : null,
      notes: trimOrNull(input.notes),
      ownership: pickOwnership(input.ownership),
      createdById: input.userId,
      ...photoData(input.photo),
    },
    select: VEHICLE_SELECT,
  });
  return serializeVehicle(row);
}

export async function updateVehicle(
  id: number,
  patch: {
    registration?: string;
    make?: string | null;
    model?: string | null;
    type?: string;
    status?: string;
    capacity?: number | null;
    notes?: string | null;
    ownership?: string | null;
  },
): Promise<VehicleSummary | null> {
  const existing = await prisma.vehicle.findUnique({
    where: { id },
    select: { id: true, vendor: { select: { internal: true } } },
  });
  if (!existing) return null;
  const data: Record<string, unknown> = {};
  if (patch.registration !== undefined) {
    const v = patch.registration.trim();
    if (v) data.registration = v;
  }
  if (patch.make !== undefined) data.make = trimOrNull(patch.make);
  if (patch.model !== undefined) data.model = trimOrNull(patch.model);
  if (patch.type !== undefined) data.type = pickVehicleType(patch.type);
  if (patch.status !== undefined) data.status = pickStatus(patch.status);
  if (patch.capacity !== undefined) data.capacity = patch.capacity && Number.isFinite(patch.capacity) ? Math.trunc(patch.capacity) : null;
  if (patch.notes !== undefined) data.notes = trimOrNull(patch.notes);
  if (patch.ownership !== undefined) {
    const ownership = pickOwnership(patch.ownership);
    data.ownership = ownership;
    // A vehicle tagged to a vendor is that vendor's kind. Saying it is the
    // other kind takes it off the vendor, so the two can never disagree.
    if (ownership && existing.vendor && (existing.vendor.internal ? 'Internal' : 'External') !== ownership) {
      data.vendorId = null;
    }
  }
  const row = await prisma.vehicle.update({ where: { id }, data, select: VEHICLE_SELECT });
  return serializeVehicle(row);
}

export async function deleteVehicle(id: number): Promise<boolean> {
  const existing = await prisma.vehicle.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return false;
  await prisma.vehicle.delete({ where: { id } });
  return true;
}

// --- Driver writes ---------------------------------------------------------

export async function createDriver(input: {
  userId: number;
  name: string;
  phone?: string | null;
  licenseNumber?: string | null;
  status?: string;
  notes?: string | null;
  photo?: PhotoInput | null;
}): Promise<DriverSummary> {
  const name = input.name.trim();
  if (!name) throw new Error('Driver name is required');
  const row = await prisma.driver.create({
    data: {
      name,
      phone: trimOrNull(input.phone),
      licenseNumber: trimOrNull(input.licenseNumber),
      status: pickStatus(input.status),
      notes: trimOrNull(input.notes),
      createdById: input.userId,
      ...photoData(input.photo),
    },
    select: DRIVER_SELECT,
  });
  return serializeDriver(row);
}

export async function updateDriver(
  id: number,
  patch: { name?: string; phone?: string | null; licenseNumber?: string | null; status?: string; notes?: string | null },
): Promise<DriverSummary | null> {
  const existing = await prisma.driver.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return null;
  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const v = patch.name.trim();
    if (v) data.name = v;
  }
  if (patch.phone !== undefined) data.phone = trimOrNull(patch.phone);
  if (patch.licenseNumber !== undefined) data.licenseNumber = trimOrNull(patch.licenseNumber);
  if (patch.status !== undefined) data.status = pickStatus(patch.status);
  if (patch.notes !== undefined) data.notes = trimOrNull(patch.notes);
  const row = await prisma.driver.update({ where: { id }, data, select: DRIVER_SELECT });
  return serializeDriver(row);
}

export async function deleteDriver(id: number): Promise<boolean> {
  const existing = await prisma.driver.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return false;
  await prisma.driver.delete({ where: { id } });
  return true;
}

// --- Officer writes --------------------------------------------------------

export async function createOfficer(input: {
  userId: number;
  name: string;
  callSign?: string | null;
  grade?: string;
  phone?: string | null;
  status?: string;
  notes?: string | null;
  photo?: PhotoInput | null;
}): Promise<OfficerSummary> {
  const name = input.name.trim();
  if (!name) throw new Error('Officer name is required');
  const row = await prisma.officer.create({
    data: {
      name,
      callSign: trimOrNull(input.callSign),
      grade: pickGrade(input.grade),
      phone: trimOrNull(input.phone),
      status: pickStatus(input.status),
      notes: trimOrNull(input.notes),
      createdById: input.userId,
      ...photoData(input.photo),
    },
    select: OFFICER_SELECT,
  });
  return serializeOfficer(row);
}

export async function updateOfficer(
  id: number,
  patch: { name?: string; callSign?: string | null; grade?: string; phone?: string | null; status?: string; notes?: string | null },
): Promise<OfficerSummary | null> {
  const existing = await prisma.officer.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return null;
  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const v = patch.name.trim();
    if (v) data.name = v;
  }
  if (patch.callSign !== undefined) data.callSign = trimOrNull(patch.callSign);
  if (patch.grade !== undefined) data.grade = pickGrade(patch.grade);
  if (patch.phone !== undefined) data.phone = trimOrNull(patch.phone);
  if (patch.status !== undefined) data.status = pickStatus(patch.status);
  if (patch.notes !== undefined) data.notes = trimOrNull(patch.notes);
  const row = await prisma.officer.update({ where: { id }, data, select: OFFICER_SELECT });
  return serializeOfficer(row);
}

export async function deleteOfficer(id: number): Promise<boolean> {
  const existing = await prisma.officer.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return false;
  await prisma.officer.delete({ where: { id } });
  return true;
}

// --- Photos (shared across vehicle/driver/officer) -------------------------

export type ResourceKind = 'vehicle' | 'driver' | 'officer';

export function isResourceKind(value: string): value is ResourceKind {
  return value === 'vehicle' || value === 'driver' || value === 'officer';
}

type PhotoCapableDelegate = {
  findUnique: (args: {
    where: { id: number };
    select: Record<string, boolean>;
  }) => Promise<Record<string, unknown> | null>;
  update: (args: {
    where: { id: number };
    data: Record<string, unknown>;
    select: Record<string, boolean>;
  }) => Promise<unknown>;
};

function photoDelegate(kind: ResourceKind): PhotoCapableDelegate {
  const map = { vehicle: prisma.vehicle, driver: prisma.driver, officer: prisma.officer };
  return map[kind] as unknown as PhotoCapableDelegate;
}

export async function setResourcePhoto(kind: ResourceKind, id: number, photo: PhotoInput): Promise<boolean> {
  const delegate = photoDelegate(kind);
  const existing = await delegate.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return false;
  await delegate.update({ where: { id }, data: photoData(photo), select: { id: true } });
  return true;
}

export async function getResourcePhoto(
  kind: ResourceKind,
  id: number,
): Promise<{ name: string; mime: string; content: Buffer } | null> {
  const delegate = photoDelegate(kind);
  const row = await delegate.findUnique({
    where: { id },
    select: { photoName: true, photoMime: true, photoContent: true },
  });
  if (!row || !row.photoContent) return null;
  return {
    name: (row.photoName as string | null) ?? 'photo',
    mime: (row.photoMime as string | null) ?? 'application/octet-stream',
    content: Buffer.from(row.photoContent as Buffer),
  };
}

// --- Assignment writes -----------------------------------------------------

async function loadAssignment(id: number): Promise<AssignmentSummary | null> {
  const row = await prisma.tripAssignment.findUnique({ where: { id }, include: ASSIGNMENT_INCLUDE });
  return row ? serializeAssignment(row) : null;
}

/**
 * Reject the allocation if any of the given resources is booked on another
 * trip for days this trip needs — by a Task Assignment allocation or by a
 * crewed itinerary movement. Other bookings on the *same* trip are fine.
 * Throws ResourceConflictError naming each clashing resource, trip and dates
 * so the user knows what to pick instead.
 */
export async function assertNoResourceConflicts(args: {
  tripId: number;
  vehicleId: number | null;
  driverId: number | null;
  officerId: number | null;
  excludeAssignmentId?: number;
}): Promise<void> {
  const wanted: Array<{ kind: EngagementKind; id: number }> = [];
  if (args.vehicleId) wanted.push({ kind: 'vehicle', id: args.vehicleId });
  if (args.driverId) wanted.push({ kind: 'driver', id: args.driverId });
  if (args.officerId) wanted.push({ kind: 'officer', id: args.officerId });
  if (wanted.length === 0) return;

  const trip = await prisma.trip.findUnique({
    where: { id: args.tripId },
    select: { startDate: true, endDate: true },
  });
  const window: DateWindow = { from: dateKeyOf(trip?.startDate), to: dateKeyOf(trip?.endDate) };

  const engagements = await listEngagements({
    resources: {
      vehicle: args.vehicleId ? [args.vehicleId] : [],
      driver: args.driverId ? [args.driverId] : [],
      officer: args.officerId ? [args.officerId] : [],
    },
  });

  const found: ResourceConflict[] = [];
  for (const { kind, id } of wanted) {
    const conflicts = conflictsFor(engagements, {
      kind,
      resourceId: id,
      tripId: args.tripId,
      window,
      excludeAssignmentId: args.excludeAssignmentId ?? null,
    });
    if (conflicts.length === 0) continue;
    const label = await resourceLabel(kind, id);
    found.push({ kind, resourceId: id, label, message: describeConflict(label, kind, conflicts), conflicts });
  }

  if (found.length > 0) {
    const tbd = !window.from || !window.to ? ' This trip has no dates yet, so anyone busy is held until it does.' : '';
    throw new ResourceConflictError(`${found.map((f) => f.message).join(' ')}${tbd}`, found);
  }
}

async function resourceLabel(kind: EngagementKind, id: number): Promise<string> {
  if (kind === 'vehicle') {
    const row = await prisma.vehicle.findUnique({ where: { id }, select: { registration: true } });
    return `Car ${row?.registration ?? `#${id}`}`;
  }
  if (kind === 'driver') {
    const row = await prisma.driver.findUnique({ where: { id }, select: { name: true } });
    return `Driver ${row?.name ?? `#${id}`}`;
  }
  const row = await prisma.officer.findUnique({ where: { id }, select: { name: true } });
  return `Officer ${row?.name ?? `#${id}`}`;
}

export async function createAssignment(input: {
  userId: number;
  tripId: number;
  vehicleId?: number | null;
  driverId?: number | null;
  officerId?: number | null;
  status?: string;
  notes?: string | null;
}): Promise<AssignmentSummary> {
  const trip = await prisma.trip.findUnique({ where: { id: input.tripId }, select: { id: true } });
  if (!trip) throw new Error('Select a valid trip for this assignment');
  if (!input.vehicleId && !input.driverId && !input.officerId) {
    throw new Error('Assign at least one resource (car, driver, or officer)');
  }
  const status = pickAssignmentStatus(input.status);
  if (isActiveStatus(status)) {
    await assertNoResourceConflicts({
      tripId: input.tripId,
      vehicleId: input.vehicleId ?? null,
      driverId: input.driverId ?? null,
      officerId: input.officerId ?? null,
    });
  }
  const row = await prisma.tripAssignment.create({
    data: {
      tripId: input.tripId,
      vehicleId: input.vehicleId ?? null,
      driverId: input.driverId ?? null,
      officerId: input.officerId ?? null,
      status,
      notes: trimOrNull(input.notes),
      createdById: input.userId,
    },
    include: ASSIGNMENT_INCLUDE,
  });
  return serializeAssignment(row);
}

export async function updateAssignment(
  id: number,
  patch: { tripId?: number; vehicleId?: number | null; driverId?: number | null; officerId?: number | null; status?: string; notes?: string | null },
): Promise<AssignmentSummary | null> {
  const existing = await prisma.tripAssignment.findUnique({
    where: { id },
    select: { id: true, tripId: true, vehicleId: true, driverId: true, officerId: true, status: true },
  });
  if (!existing) return null;
  const data: Record<string, unknown> = {};
  let effectiveTripId = existing.tripId;
  if (patch.tripId !== undefined) {
    const trip = await prisma.trip.findUnique({ where: { id: patch.tripId }, select: { id: true } });
    if (trip) {
      data.tripId = patch.tripId;
      effectiveTripId = patch.tripId;
    }
  }
  if (patch.vehicleId !== undefined) data.vehicleId = patch.vehicleId ?? null;
  if (patch.driverId !== undefined) data.driverId = patch.driverId ?? null;
  if (patch.officerId !== undefined) data.officerId = patch.officerId ?? null;
  if (patch.status !== undefined) data.status = pickAssignmentStatus(patch.status);
  if (patch.notes !== undefined) data.notes = trimOrNull(patch.notes);

  // Effective resources/status after this patch is applied.
  const effectiveVehicleId = patch.vehicleId !== undefined ? patch.vehicleId ?? null : existing.vehicleId;
  const effectiveDriverId = patch.driverId !== undefined ? patch.driverId ?? null : existing.driverId;
  const effectiveOfficerId = patch.officerId !== undefined ? patch.officerId ?? null : existing.officerId;
  const effectiveStatus = patch.status !== undefined ? pickAssignmentStatus(patch.status) : existing.status;
  if (isActiveStatus(effectiveStatus)) {
    await assertNoResourceConflicts({
      tripId: effectiveTripId,
      vehicleId: effectiveVehicleId,
      driverId: effectiveDriverId,
      officerId: effectiveOfficerId,
      excludeAssignmentId: id,
    });
  }

  await prisma.tripAssignment.update({ where: { id }, data });
  return loadAssignment(id);
}

export async function deleteAssignment(id: number): Promise<boolean> {
  const existing = await prisma.tripAssignment.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return false;
  await prisma.tripAssignment.delete({ where: { id } });
  return true;
}
