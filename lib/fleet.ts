import { APP_LOCALE } from './locale';

/**
 * Car Fuel and Car Maintenance, the Fleet modules beside Vehicles: option sets,
 * the shapes the pages receive, and the arithmetic they share. No server
 * imports, so the client pages use it too; the database side is
 * lib/fleet-server.ts.
 *
 * Dates without a time (service dates) travel as "YYYY-MM-DD" keys and are
 * stored as UTC midnight, so they read the same in every timezone.
 */

export const FUEL_TYPES = ['Petrol', 'Diesel', 'Hybrid', 'Electric', 'LPG'] as const;
/** Scheduled: planned upkeep on a timetable. Unscheduled: breakdowns, accidents, faults. */
export const MAINTENANCE_KINDS = ['Scheduled', 'Unscheduled'] as const;
export const MAINTENANCE_CATEGORIES = [
  'Service',
  'Inspection',
  'Repair',
  'Breakdown',
  'Accident',
  'Tyres',
  'Bodywork',
  'Insurance',
  'Other',
] as const;
export const MAINTENANCE_STATUSES = ['Planned', 'In progress', 'Completed', 'Cancelled'] as const;

export type FuelType = (typeof FUEL_TYPES)[number];
export type MaintenanceKind = (typeof MAINTENANCE_KINDS)[number];
export type MaintenanceCategory = (typeof MAINTENANCE_CATEGORIES)[number];
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];

/** The kind a category usually is, which the form suggests when the category is picked. */
export const SUGGESTED_KIND: Partial<Record<string, MaintenanceKind>> = {
  Service: 'Scheduled',
  Inspection: 'Scheduled',
  Tyres: 'Scheduled',
  Insurance: 'Scheduled',
  Repair: 'Unscheduled',
  Breakdown: 'Unscheduled',
  Accident: 'Unscheduled',
};

/** Planned work this close counts as due soon. */
export const DUE_SOON_DAYS = 14;

/** How many days ahead a reminder can go out; 0 is on the day. */
export const REMINDER_DAY_OPTIONS = [0, 1, 3, 7, 14, 30] as const;
/** A km-based next service reminds once the odometer is this close. */
export const KM_REMINDER_MARGIN = 1000;

/** Services and inspections remind a week ahead unless told otherwise; other work only when asked. */
export function defaultReminderDays(category: string): number | null {
  return category === 'Service' || category === 'Inspection' ? 7 : null;
}

export type FleetVehicleRef = { id: number; registration: string; make: string | null; model: string | null };

export type FuelLogDto = {
  id: number;
  vehicle: FleetVehicleRef;
  filledAt: string;
  litres: number;
  cost: number | null;
  currency: string;
  odometerKm: number | null;
  fuelType: string;
  fullTank: boolean;
  station: string | null;
  filledBy: string | null;
  notes: string | null;
  createdBy: { id: number; name: string } | null;
  createdAt: string;
};

export type MaintenanceDto = {
  id: number;
  vehicle: FleetVehicleRef;
  kind: string;
  category: string;
  title: string;
  status: string;
  /** "YYYY-MM-DD" */
  scheduledFor: string | null;
  /** "YYYY-MM-DD" */
  completedAt: string | null;
  odometerKm: number | null;
  cost: number | null;
  currency: string;
  provider: string | null;
  /** "YYYY-MM-DD" */
  nextDueAt: string | null;
  nextDueKm: number | null;
  /** Days before the planned or next-due date to remind; null for no reminder. */
  reminderDays: number | null;
  notes: string | null;
  createdBy: { id: number; name: string } | null;
  createdAt: string;
};

// --- Dates -------------------------------------------------------------------

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function isDateKey(value: string): boolean {
  if (!DATE_KEY.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function dateKeyToDate(key: string): Date {
  return new Date(`${key}T00:00:00Z`);
}

export function dateToDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Today's key in the timezone this code runs in (the server's TZ is the business's). */
export function localDateKey(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Whole days from `from` to `to`, both "YYYY-MM-DD". */
export function daysBetween(from: string, to: string): number {
  return Math.round((dateKeyToDate(to).getTime() - dateKeyToDate(from).getTime()) / 86_400_000);
}

/** A "YYYY-MM-DD" key, read as the calendar day it names wherever it is shown. */
export function formatDateKey(key: string | null): string {
  if (!key) return '—';
  return dateKeyToDate(key).toLocaleDateString(APP_LOCALE, {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// --- Money -------------------------------------------------------------------

/** Sums kept apart by currency: adding KES to USD would be meaningless. */
export function totalsByCurrency(rows: { cost: number | null; currency: string }[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const row of rows) {
    if (row.cost == null) continue;
    totals[row.currency] = Math.round(((totals[row.currency] ?? 0) + row.cost) * 100) / 100;
  }
  return totals;
}

// --- Fuel economy ------------------------------------------------------------

export type FuelEconomy = { distanceKm: number; litres: number; kmPerLitre: number };

/**
 * Consumption by the full-tank method: at each full fill-up, the distance since
 * the previous full fill-up over the litres put in since (partial top-ups
 * included). A full fill-up without an odometer reading breaks the chain, as
 * does a reading lower than the last one.
 */
export function fuelEconomyByLog(
  logs: Pick<FuelLogDto, 'id' | 'vehicle' | 'filledAt' | 'litres' | 'odometerKm' | 'fullTank'>[],
): Map<number, FuelEconomy> {
  const result = new Map<number, FuelEconomy>();
  const byVehicle = new Map<number, typeof logs>();
  for (const log of logs) {
    const list = byVehicle.get(log.vehicle.id) ?? [];
    list.push(log);
    byVehicle.set(log.vehicle.id, list);
  }

  for (const list of byVehicle.values()) {
    list.sort((a, b) => a.filledAt.localeCompare(b.filledAt) || a.id - b.id);
    let anchorKm: number | null = null;
    let litresSince = 0;
    for (const log of list) {
      litresSince += log.litres;
      if (!log.fullTank) continue;
      if (log.odometerKm == null) {
        anchorKm = null;
      } else {
        const distanceKm = anchorKm == null ? 0 : log.odometerKm - anchorKm;
        if (distanceKm > 0 && litresSince > 0) {
          result.set(log.id, {
            distanceKm,
            litres: Math.round(litresSince * 100) / 100,
            kmPerLitre: Math.round((distanceKm / litresSince) * 100) / 100,
          });
        }
        anchorKm = log.odometerKm;
      }
      litresSince = 0;
    }
  }
  return result;
}

/** Overall km per litre across the given economies, weighted by distance. */
export function averageKmPerLitre(economies: Iterable<FuelEconomy>): number | null {
  let distance = 0;
  let litres = 0;
  for (const e of economies) {
    distance += e.distanceKm;
    litres += e.litres;
  }
  return litres > 0 ? Math.round((distance / litres) * 100) / 100 : null;
}

// --- Maintenance -------------------------------------------------------------

export type MaintenanceDisplayStatus = MaintenanceStatus | 'Overdue' | 'Due soon';

/** The stored status, sharpened by the date for work that is still planned. */
export function maintenanceDisplayStatus(
  item: Pick<MaintenanceDto, 'status' | 'scheduledFor'>,
  today: string,
): MaintenanceDisplayStatus {
  const status = (MAINTENANCE_STATUSES as readonly string[]).includes(item.status)
    ? (item.status as MaintenanceStatus)
    : 'Planned';
  if (status !== 'Planned' || !item.scheduledFor) return status;
  const days = daysBetween(today, item.scheduledFor);
  if (days < 0) return 'Overdue';
  if (days <= DUE_SOON_DAYS) return 'Due soon';
  return status;
}

export function isOpenMaintenance(item: Pick<MaintenanceDto, 'status'>): boolean {
  return item.status === 'Planned' || item.status === 'In progress';
}

type NextDueFields = Pick<MaintenanceDto, 'id' | 'vehicle' | 'category' | 'status' | 'completedAt'>;

/**
 * The completed jobs whose next-due date or km still stands: per vehicle and
 * category, the latest one, unless the next one is already booked (planned or
 * in progress).
 */
export function outstandingNextDue<T extends NextDueFields>(items: T[]): T[] {
  const latest = new Map<string, T>();
  const booked = new Set<string>();
  for (const item of items) {
    const key = `${item.vehicle.id}:${item.category}`;
    if (isOpenMaintenance(item)) booked.add(key);
    if (item.status !== 'Completed') continue;
    const current = latest.get(key);
    const later =
      !current ||
      (item.completedAt ?? '') > (current.completedAt ?? '') ||
      ((item.completedAt ?? '') === (current.completedAt ?? '') && item.id > current.id);
    if (later) latest.set(key, item);
  }
  return [...latest.entries()].filter(([key]) => !booked.has(key)).map(([, item]) => item);
}

export type ReminderFields = NextDueFields &
  Pick<MaintenanceDto, 'title' | 'scheduledFor' | 'nextDueAt' | 'nextDueKm' | 'reminderDays'>;

export type MaintenanceReminder<T extends ReminderFields = MaintenanceDto> = {
  /** Names the job, what it is due by, and the stage, so each reminder reaches each user once. */
  key: string;
  item: T;
  /** A planned job's date, or a completed job's next-due date or km. */
  basis: 'planned' | 'next-date' | 'next-km';
  stage: 'upcoming' | 'overdue';
  dueDate: string | null;
  dueKm: number | null;
  /** The vehicle's highest odometer reading on file. */
  currentKm: number | null;
  /** Days until dueDate, negative once it has passed; null for a km reminder. */
  daysLeft: number | null;
};

/**
 * The reminders that are live today. A job with a reminder set reminds its
 * days ahead of the planned date (or the next-due date, once completed), and
 * again once that date has passed; a next-due km reminds when the vehicle's
 * odometer comes within KM_REMINDER_MARGIN of it, and again once past it.
 */
export function activeMaintenanceReminders<T extends ReminderFields>(
  items: T[],
  odometers: Record<number, number>,
  today: string,
): MaintenanceReminder<T>[] {
  const reminders: MaintenanceReminder<T>[] = [];
  const byDate = (item: T, basis: 'planned' | 'next-date', due: string) => {
    const daysLeft = daysBetween(today, due);
    if (daysLeft > (item.reminderDays ?? -1)) return;
    const stage = daysLeft < 0 ? 'overdue' : 'upcoming';
    reminders.push({
      key: `${basis}:${item.id}:${due}:${stage}`,
      item,
      basis,
      stage,
      dueDate: due,
      dueKm: null,
      currentKm: odometers[item.vehicle.id] ?? null,
      daysLeft,
    });
  };

  for (const item of items) {
    if (item.reminderDays != null && item.status === 'Planned' && item.scheduledFor) {
      byDate(item, 'planned', item.scheduledFor);
    }
  }
  for (const item of outstandingNextDue(items)) {
    if (item.reminderDays == null) continue;
    if (item.nextDueAt) byDate(item, 'next-date', item.nextDueAt);
    const currentKm = odometers[item.vehicle.id];
    if (item.nextDueKm != null && currentKm != null && currentKm >= item.nextDueKm - KM_REMINDER_MARGIN) {
      const stage = currentKm > item.nextDueKm ? 'overdue' : 'upcoming';
      reminders.push({
        key: `next-km:${item.id}:${item.nextDueKm}:${stage}`,
        item,
        basis: 'next-km',
        stage,
        dueDate: null,
        dueKm: item.nextDueKm,
        currentKm,
        daysLeft: null,
      });
    }
  }

  const urgency = (r: MaintenanceReminder<T>) => (r.stage === 'overdue' ? 0 : 1);
  return reminders.sort(
    (a, b) => urgency(a) - urgency(b) || (a.daysLeft ?? 0) - (b.daysLeft ?? 0) || a.item.id - b.item.id,
  );
}

const km = (value: number) => `${value.toLocaleString(APP_LOCALE)} km`;
const dayCount = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

/** The sentence a reminder shows in the bell and on the Car Maintenance page. */
export function reminderMessage(reminder: MaintenanceReminder<ReminderFields>): string {
  const { item, stage, daysLeft } = reminder;
  const subject = `${item.category} for ${item.vehicle.registration}`;
  const work = item.title.trim() && item.title.trim() !== item.category ? ` — ${item.title.trim()}` : '';

  if (reminder.basis === 'next-km') {
    const reading = reminder.currentKm != null ? ` (last reading ${km(reminder.currentKm)})` : '';
    return stage === 'overdue'
      ? `${subject} is past due at ${km(reminder.dueKm!)}${reading}${work}`
      : `${subject} is due at ${km(reminder.dueKm!)}${reading}${work}`;
  }

  const date = formatDateKey(reminder.dueDate);
  const planned = reminder.basis === 'planned';
  if (stage === 'overdue') {
    return planned
      ? `${subject} was planned for ${date} and is not done yet (${dayCount(-daysLeft!)} overdue)${work}`
      : `${subject} was due on ${date} (${dayCount(-daysLeft!)} overdue)${work}`;
  }
  const when = daysLeft === 0 ? 'today' : `on ${date} (in ${dayCount(daysLeft!)})`;
  return planned ? `${subject} is planned ${when}${work}` : `${subject} is due ${when}${work}`;
}

export function vehicleLabel(vehicle: FleetVehicleRef): string {
  const name = [vehicle.make, vehicle.model].filter(Boolean).join(' ');
  return name ? `${vehicle.registration} · ${name}` : vehicle.registration;
}
