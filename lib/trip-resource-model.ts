/**
 * The trip resource pool's rules, with no database and no React: what kind of
 * thing a staged service is, whether an event used it, how many hours a shift
 * ran, and the billing log built from all of it. Client-safe; the pool panel,
 * the reconciliation dialog, the billing view and the CSV export share it.
 */

export const VENDOR_STATUSES = ['Pending', 'Approved', 'Suspended'] as const;
export type VendorStatus = (typeof VENDOR_STATUSES)[number];

/** What a staged service puts on the road: a vehicle (with its driver), people, or neither. */
export type ResourceKind = 'vehicle' | 'personnel' | 'other';

const VEHICLE_CATEGORIES = new Set(['Transfers', 'Vehicle Hire', 'Excursion & Safari', 'Escort']);
const PERSONNEL_CATEGORIES = new Set(['Personnel', 'Airport Services']);

export function resourceKind(category: string | null | undefined): ResourceKind {
  if (category && VEHICLE_CATEGORIES.has(category)) return 'vehicle';
  if (category && PERSONNEL_CATEGORIES.has(category)) return 'personnel';
  return 'other';
}

/**
 * The fleet register's vehicle types a service class can be met with, or null
 * when the class says nothing about the vehicle (so nothing is narrowed).
 */
export function vehicleTypesForClass(serviceClass: string | null | undefined): string[] | null {
  const name = (serviceClass ?? '').toLowerCase();
  if (!name) return null;
  if (/suv|land cruiser|armou?red/.test(name)) return ['SUV', 'Armoured'];
  if (/sedan/.test(name)) return ['Sedan'];
  if (/van|bus/.test(name)) return ['Van'];
  return null;
}

/** The Controller's verdict on a staged resource no event used. */
export type ResourceResolution = 'unused' | 'used';

export interface TripResourceSummary {
  id: number;
  vendorId: number | null;
  vendorName: string;
  productId: number | null;
  serviceName: string;
  serviceCode: string | null;
  category: string | null;
  /** The catalog's sub-category today (it gives a transport event its Type); null once the service is gone. */
  subCategory: string | null;
  serviceClass: string | null;
  unitOfMeasure: string | null;
  kind: ResourceKind;
  /** "YYYY-MM-DD", inclusive; null when staged without dates. */
  startDate: string | null;
  endDate: string | null;
  quantity: number;
  resolution: ResourceResolution | null;
  billableHours: number | null;
  startOdometer: number | null;
  endOdometer: number | null;
  resolvedAt: string | null;
  resolvedBy: { id: number; name: string } | null;
}

export type DayLogKind = 'driver' | 'officer' | 'vehicle';

/** One person's shift or one vehicle's odometer on one trip day. */
export interface TripDayLogSummary {
  id: number;
  dayId: number;
  kind: DayLogKind;
  /** The register id it was logged against; null once they have left the register. */
  subjectId: number | null;
  label: string;
  /** "HH:MM". */
  shiftStart: string | null;
  shiftEnd: string | null;
  startOdometer: number | null;
  endOdometer: number | null;
}

// ── Dates ─────────────────────────────────────────────────────────────────

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

function utcDay(key: string): number | null {
  if (!DATE_KEY.test(key)) return null;
  const [y, m, d] = key.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d);
  // Rejects 2026-02-31, which Date would roll into March.
  return new Date(ms).getUTCDate() === d ? ms / 86_400_000 : null;
}

/** Inclusive days between two date keys; null without both, or when they run backwards. */
export function daysInRange(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const a = utcDay(start);
  const b = utcDay(end);
  if (a === null || b === null || b < a) return null;
  return b - a + 1;
}

/** A resource staged without dates is there for the whole trip. */
export function coversDate(resource: Pick<TripResourceSummary, 'startDate' | 'endDate'>, dateKey: string | null): boolean {
  if (!dateKey) return true;
  if (resource.startDate && dateKey < resource.startDate) return false;
  if (resource.endDate && dateKey > resource.endDate) return false;
  return true;
}

/** "Nov 8 – Nov 11", "Nov 8", or "Whole trip". Reads the key as written, so no timezone can shift it. */
export function formatDateRange(start: string | null, end: string | null, locale?: string): string {
  const fmt = (key: string) => {
    const day = utcDay(key);
    if (day === null) return key;
    return new Date(day * 86_400_000).toLocaleDateString(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  };
  if (start && end) return start === end ? fmt(start) : `${fmt(start)} – ${fmt(end)}`;
  if (start) return `From ${fmt(start)}`;
  if (end) return `Until ${fmt(end)}`;
  return 'Whole trip';
}

/** Charged by the day (per day, per person / per day), as opposed to per transfer, arrival or traveller. */
export function isPerDay(unitOfMeasure: string | null | undefined): boolean {
  return /\bday\b/i.test(unitOfMeasure ?? '');
}

// ── Use ───────────────────────────────────────────────────────────────────

interface UsageItem {
  dayId: number | null;
  resourceIds: number[];
}

interface UsageDay {
  id: number;
  dateKey: string | null;
  dayNumber: number;
}

export type ResourceState =
  /** At least one event draws on it. */
  | 'assigned'
  /** No event uses it and nobody has said whether it was used. */
  | 'unassigned'
  /** Verified as used though no event shows it: billed from the figures logged. */
  | 'kept'
  /** Verified as not used: not billed. */
  | 'unused';

export interface ResourceUsage {
  state: ResourceState;
  eventCount: number;
  /** The itinerary days with an event on it, in trip order. */
  usedDayIds: number[];
  /** Days staged for, from its dates; null without dates. */
  stagedDays: number | null;
  /** Staged days no event has used yet; null without dates. */
  remainingDays: number | null;
}

export function resourceUsage(
  resource: Pick<TripResourceSummary, 'id' | 'startDate' | 'endDate' | 'resolution'>,
  items: readonly UsageItem[],
  days: readonly UsageDay[],
): ResourceUsage {
  const mine = items.filter((item) => item.resourceIds.includes(resource.id));
  const order = new Map(days.map((day) => [day.id, day.dayNumber]));
  const usedDayIds = [...new Set(mine.flatMap((item) => (item.dayId != null && order.has(item.dayId) ? [item.dayId] : [])))].sort(
    (a, b) => order.get(a)! - order.get(b)!,
  );
  const stagedDays = daysInRange(resource.startDate, resource.endDate);
  const state: ResourceState =
    mine.length > 0 ? 'assigned' : resource.resolution === 'used' ? 'kept' : resource.resolution === 'unused' ? 'unused' : 'unassigned';
  return {
    state,
    eventCount: mine.length,
    usedDayIds,
    stagedDays,
    remainingDays: stagedDays === null ? null : Math.max(0, stagedDays - usedDayIds.length),
  };
}

/** Staged, on no event, and not yet verified: what stops a trip being completed. */
export function unverifiedResources<R extends Pick<TripResourceSummary, 'id' | 'startDate' | 'endDate' | 'resolution'>>(
  resources: readonly R[],
  items: readonly UsageItem[],
): R[] {
  const used = new Set(items.flatMap((item) => item.resourceIds));
  return resources.filter((resource) => !used.has(resource.id) && resource.resolution === null);
}

/** "1 unused resource needs verification". */
export function verificationNotice(count: number): string {
  return `${count} unused resource${count === 1 ? '' : 's'} need${count === 1 ? 's' : ''} verification`;
}

// ── Shifts and odometers ──────────────────────────────────────────────────

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isClockTime(value: string): boolean {
  return CLOCK.test(value);
}

function minutesOf(value: string | null): number | null {
  const match = value ? CLOCK.exec(value) : null;
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** Hours on shift, to two decimals. An end at or before the start ran past midnight. */
export function shiftHours(start: string | null, end: string | null): number | null {
  const a = minutesOf(start);
  const b = minutesOf(end);
  if (a === null || b === null) return null;
  const minutes = b > a ? b - a : b + 24 * 60 - a;
  return Math.round((minutes / 60) * 100) / 100;
}

/** Kilometres driven; null until both readings are in, or when the end is behind the start. */
export function distanceKm(start: number | null, end: number | null): number | null {
  if (start === null || end === null || end < start) return null;
  return end - start;
}

/** "9 h 30 min", "12 h", "45 min". */
export function formatHours(hours: number): string {
  const minutes = Math.round(hours * 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export interface DayTotals {
  /** Hours across everyone with both times in. */
  hours: number;
  /** Kilometres across every vehicle with both readings in. */
  km: number;
  /** Lines still missing a start or an end. */
  open: number;
}

export function dayTotals(logs: readonly TripDayLogSummary[]): DayTotals {
  let hours = 0;
  let km = 0;
  let open = 0;
  for (const log of logs) {
    if (log.kind === 'vehicle') {
      const driven = distanceKm(log.startOdometer, log.endOdometer);
      if (driven === null) open += 1;
      else km += driven;
    } else {
      const worked = shiftHours(log.shiftStart, log.shiftEnd);
      if (worked === null) open += 1;
      else hours += worked;
    }
  }
  return { hours: Math.round(hours * 100) / 100, km, open };
}

// ── Who the pool puts on a day ────────────────────────────────────────────

export interface PoolCrewFilter {
  /** Vendors with a vehicle service staged for the day: their drivers and vehicles are offered. */
  vehicleVendors: Set<number>;
  /** Vendors with a personnel service staged for the day: their CPOs are offered. */
  personnelVendors: Set<number>;
  /** Per vendor, the vehicle types its staged services call for; absent means any of its vehicles. */
  vehicleTypes: Map<number, Set<string>>;
}

/**
 * Staging a vendor's service for a day puts that vendor's people and vehicles
 * on offer that day: a vehicle service offers its drivers and matching
 * vehicles, a personnel service its officers.
 */
export function poolCrewFilter(resources: readonly TripResourceSummary[], dateKey: string | null): PoolCrewFilter {
  const filter: PoolCrewFilter = { vehicleVendors: new Set(), personnelVendors: new Set(), vehicleTypes: new Map() };
  const anyVehicle = new Set<number>();
  for (const resource of resources) {
    if (resource.vendorId == null || resource.resolution === 'unused' || !coversDate(resource, dateKey)) continue;
    if (resource.kind === 'personnel') filter.personnelVendors.add(resource.vendorId);
    if (resource.kind !== 'vehicle') continue;
    filter.vehicleVendors.add(resource.vendorId);
    const types = vehicleTypesForClass(resource.serviceClass);
    if (!types) anyVehicle.add(resource.vendorId);
    else {
      const known = filter.vehicleTypes.get(resource.vendorId) ?? new Set<string>();
      for (const type of types) known.add(type);
      filter.vehicleTypes.set(resource.vendorId, known);
    }
  }
  // One staged service that names no vehicle class opens the vendor's whole fleet.
  for (const vendorId of anyVehicle) filter.vehicleTypes.delete(vendorId);
  return filter;
}

interface PoolCrewOption {
  vendorId: number | null;
  vehicleType?: string | null;
}

/** Whether the pool offers this driver, CPO or vehicle on the day the filter was built for. */
export function inPool(filter: PoolCrewFilter, kind: DayLogKind, option: PoolCrewOption): boolean {
  if (option.vendorId == null) return false;
  if (kind === 'officer') return filter.personnelVendors.has(option.vendorId);
  if (!filter.vehicleVendors.has(option.vendorId)) return false;
  if (kind === 'driver') return true;
  const types = filter.vehicleTypes.get(option.vendorId);
  return !types || !option.vehicleType || types.has(option.vehicleType);
}

// ── Billing log ───────────────────────────────────────────────────────────

export interface BillingServiceLine {
  resourceId: number;
  vendorName: string;
  serviceName: string;
  serviceCode: string | null;
  unitOfMeasure: string | null;
  quantity: number;
  startDate: string | null;
  endDate: string | null;
  stagedDays: number | null;
  /** Itinerary days with an event on it. */
  usedDays: number;
  /** "Day 1, Day 2". */
  usedOn: string;
  eventCount: number;
  status: 'Assigned' | 'Kept and logged' | 'Needs verification';
  /** Entered at reconciliation, for a resource kept without an event. */
  billableHours: number | null;
  startOdometer: number | null;
  endOdometer: number | null;
  km: number | null;
}

export interface BillingDayLine {
  logId: number;
  dayId: number;
  dayNumber: number;
  dateKey: string | null;
  kind: DayLogKind;
  label: string;
  shiftStart: string | null;
  shiftEnd: string | null;
  hours: number | null;
  startOdometer: number | null;
  endOdometer: number | null;
  km: number | null;
}

export interface BillingLog {
  services: BillingServiceLine[];
  /** Verified as unused: left off the bill, listed so the decision can be seen. */
  notBilled: Array<{ resourceId: number; vendorName: string; serviceName: string; quantity: number; startDate: string | null; endDate: string | null }>;
  days: BillingDayLine[];
  totals: { hours: number; km: number; keptHours: number; keptKm: number };
}

interface BillingTrip {
  items: readonly UsageItem[];
  days: readonly UsageDay[];
  resources: readonly TripResourceSummary[];
  dayLogs: readonly TripDayLogSummary[];
}

const KIND_ORDER: Record<DayLogKind, number> = { driver: 0, officer: 1, vehicle: 2 };

export function buildBillingLog(trip: BillingTrip): BillingLog {
  const dayById = new Map(trip.days.map((day) => [day.id, day]));
  const services: BillingServiceLine[] = [];
  const notBilled: BillingLog['notBilled'] = [];

  for (const resource of trip.resources) {
    const usage = resourceUsage(resource, trip.items, trip.days);
    if (usage.state === 'unused') {
      notBilled.push({
        resourceId: resource.id,
        vendorName: resource.vendorName,
        serviceName: resource.serviceName,
        quantity: resource.quantity,
        startDate: resource.startDate,
        endDate: resource.endDate,
      });
      continue;
    }
    const kept = usage.state === 'kept';
    services.push({
      resourceId: resource.id,
      vendorName: resource.vendorName,
      serviceName: resource.serviceName,
      serviceCode: resource.serviceCode,
      unitOfMeasure: resource.unitOfMeasure,
      quantity: resource.quantity,
      startDate: resource.startDate,
      endDate: resource.endDate,
      stagedDays: usage.stagedDays,
      usedDays: usage.usedDayIds.length,
      usedOn: usage.usedDayIds.map((id) => `Day ${dayById.get(id)!.dayNumber}`).join(', '),
      eventCount: usage.eventCount,
      status: usage.state === 'assigned' ? 'Assigned' : kept ? 'Kept and logged' : 'Needs verification',
      billableHours: kept ? resource.billableHours : null,
      startOdometer: kept ? resource.startOdometer : null,
      endOdometer: kept ? resource.endOdometer : null,
      km: kept ? distanceKm(resource.startOdometer, resource.endOdometer) : null,
    });
  }

  const days: BillingDayLine[] = trip.dayLogs
    .flatMap((log) => {
      const day = dayById.get(log.dayId);
      if (!day) return [];
      return [
        {
          logId: log.id,
          dayId: day.id,
          dayNumber: day.dayNumber,
          dateKey: day.dateKey,
          kind: log.kind,
          label: log.label,
          shiftStart: log.kind === 'vehicle' ? null : log.shiftStart,
          shiftEnd: log.kind === 'vehicle' ? null : log.shiftEnd,
          hours: log.kind === 'vehicle' ? null : shiftHours(log.shiftStart, log.shiftEnd),
          startOdometer: log.kind === 'vehicle' ? log.startOdometer : null,
          endOdometer: log.kind === 'vehicle' ? log.endOdometer : null,
          km: log.kind === 'vehicle' ? distanceKm(log.startOdometer, log.endOdometer) : null,
        },
      ];
    })
    .sort((a, b) => a.dayNumber - b.dayNumber || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.label.localeCompare(b.label));

  const sum = (values: Array<number | null>) => Math.round(values.reduce<number>((total, value) => total + (value ?? 0), 0) * 100) / 100;
  return {
    services,
    notBilled,
    days,
    totals: {
      hours: sum(days.map((line) => line.hours)),
      km: sum(days.map((line) => line.km)),
      keptHours: sum(services.map((line) => line.billableHours)),
      keptKm: sum(services.map((line) => line.km)),
    },
  };
}

/** Quoted when it must be, and never read as a formula by a spreadsheet. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const BILLING_CSV_HEADERS = [
  'Trip',
  'Client',
  'Section',
  'Day',
  'Date',
  'Vendor',
  'Item',
  'Service code',
  'Unit',
  'Quantity',
  'Staged from',
  'Staged to',
  'Days staged',
  'Days used',
  'Events',
  'Shift start',
  'Shift end',
  'Hours',
  'Start odometer (km)',
  'End odometer (km)',
  'Kilometres',
  'Status',
] as const;

const KIND_LABEL: Record<DayLogKind, string> = { driver: 'Driver', officer: 'Close Protection Officer', vehicle: 'Vehicle' };

/**
 * The billing log as one flat table: a row per billable service, then a row
 * per shift and odometer line. Resources verified as unused are left out.
 */
export function billingCsv(log: BillingLog, trip: { reference: string; client: string }): string {
  const rows: Array<Array<string | number | null>> = [];
  for (const line of log.services) {
    rows.push([
      trip.reference, trip.client, 'Service', '', '',
      line.vendorName, line.serviceName, line.serviceCode, line.unitOfMeasure, line.quantity,
      line.startDate, line.endDate, line.stagedDays, line.usedDays, line.eventCount,
      '', '', line.billableHours, line.startOdometer, line.endOdometer, line.km, line.status,
    ]);
  }
  for (const line of log.days) {
    rows.push([
      trip.reference, trip.client, line.kind === 'vehicle' ? 'Odometer' : 'Shift', `Day ${line.dayNumber}`, line.dateKey,
      '', line.label, '', KIND_LABEL[line.kind], '',
      '', '', '', '', '',
      line.shiftStart, line.shiftEnd, line.hours, line.startOdometer, line.endOdometer, line.km,
      line.kind === 'vehicle' ? (line.km === null ? 'Incomplete' : 'Logged') : line.hours === null ? 'Incomplete' : 'Logged',
    ]);
  }
  return [BILLING_CSV_HEADERS.join(','), ...rows.map((row) => row.map(csvCell).join(','))].join('\r\n') + '\r\n';
}
