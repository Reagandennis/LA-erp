import { describe, expect, it } from 'vitest';

import {
  type FleetVehicleRef,
  type FuelLogDto,
  type MaintenanceDto,
  activeMaintenanceReminders,
  averageKmPerLitre,
  daysBetween,
  defaultReminderDays,
  fuelEconomyByLog,
  isDateKey,
  maintenanceDisplayStatus,
  outstandingNextDue,
  reminderMessage,
  totalsByCurrency,
} from '../lib/fleet';
import {
  fuelLogCreateSchema,
  fuelLogUpdateSchema,
  maintenanceCreateSchema,
  maintenanceUpdateSchema,
} from '../lib/validation';

const CAR: FleetVehicleRef = { id: 1, registration: 'KDA 123A', make: 'Toyota', model: 'Prado' };
const VAN: FleetVehicleRef = { id: 2, registration: 'KDB 456B', make: null, model: null };

let nextId = 1;
function fill(day: string, litres: number, odometerKm: number | null, opts: { fullTank?: boolean; vehicle?: FleetVehicleRef } = {}) {
  return {
    id: nextId++,
    vehicle: opts.vehicle ?? CAR,
    filledAt: `${day}T08:00:00.000Z`,
    litres,
    odometerKm,
    fullTank: opts.fullTank ?? true,
  } satisfies Pick<FuelLogDto, 'id' | 'vehicle' | 'filledAt' | 'litres' | 'odometerKm' | 'fullTank'>;
}

function job(overrides: Partial<MaintenanceDto>): MaintenanceDto {
  return {
    id: nextId++,
    vehicle: CAR,
    kind: 'Scheduled',
    category: 'Service',
    title: 'Service',
    status: 'Planned',
    scheduledFor: null,
    completedAt: null,
    odometerKm: null,
    cost: null,
    currency: 'KES',
    provider: null,
    nextDueAt: null,
    nextDueKm: null,
    reminderDays: null,
    notes: null,
    createdBy: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('fuelEconomyByLog', () => {
  it('divides the distance between full fill-ups by the litres put in since', () => {
    const first = fill('2026-10-01', 50, 10_000);
    const second = fill('2026-10-08', 40, 10_500);
    const economy = fuelEconomyByLog([second, first]);
    expect(economy.has(first.id)).toBe(false);
    expect(economy.get(second.id)).toEqual({ distanceKm: 500, litres: 40, kmPerLitre: 12.5 });
  });

  it('counts partial top-ups towards the next full fill-up', () => {
    const a = fill('2026-10-01', 50, 10_000);
    const topUp = fill('2026-10-03', 10, 10_150, { fullTank: false });
    const b = fill('2026-10-06', 30, 10_480);
    const economy = fuelEconomyByLog([a, topUp, b]);
    expect(economy.has(topUp.id)).toBe(false);
    expect(economy.get(b.id)).toEqual({ distanceKm: 480, litres: 40, kmPerLitre: 12 });
  });

  it('breaks the chain at a full fill-up without a reading, or a reading that goes backwards', () => {
    const a = fill('2026-10-01', 50, 10_000);
    const noReading = fill('2026-10-04', 45, null);
    const b = fill('2026-10-07', 40, 10_900);
    const typo = fill('2026-10-10', 40, 1_090);
    const c = fill('2026-10-14', 40, 1_590);
    const economy = fuelEconomyByLog([a, noReading, b, typo, c]);
    expect(economy.has(b.id)).toBe(false);
    expect(economy.has(typo.id)).toBe(false);
    expect(economy.get(c.id)?.distanceKm).toBe(500);
  });

  it('keeps each vehicle to its own history', () => {
    const car1 = fill('2026-10-01', 50, 10_000);
    const van1 = fill('2026-10-02', 60, 80_000, { vehicle: VAN });
    const car2 = fill('2026-10-03', 25, 10_300);
    const van2 = fill('2026-10-04', 60, 80_600, { vehicle: VAN });
    const economy = fuelEconomyByLog([car1, van1, car2, van2]);
    expect(economy.get(car2.id)?.kmPerLitre).toBe(12);
    expect(economy.get(van2.id)?.kmPerLitre).toBe(10);
    expect(averageKmPerLitre(economy.values())).toBe(10.59);
    expect(averageKmPerLitre([])).toBeNull();
  });
});

describe('totalsByCurrency', () => {
  it('never adds one currency to another, and skips missing costs', () => {
    expect(
      totalsByCurrency([
        { cost: 100.1, currency: 'KES' },
        { cost: null, currency: 'KES' },
        { cost: 0.2, currency: 'KES' },
        { cost: 30, currency: 'USD' },
      ]),
    ).toEqual({ KES: 100.3, USD: 30 });
  });
});

describe('maintenance dates', () => {
  const today = '2026-10-27';

  it('reads date keys strictly', () => {
    expect(isDateKey('2026-02-28')).toBe(true);
    expect(isDateKey('2026-02-30')).toBe(false);
    expect(isDateKey('2026-2-3')).toBe(false);
    expect(daysBetween('2026-10-27', '2026-11-03')).toBe(7);
  });

  it('marks planned work overdue or due soon from its date', () => {
    expect(maintenanceDisplayStatus({ status: 'Planned', scheduledFor: '2026-10-26' }, today)).toBe('Overdue');
    expect(maintenanceDisplayStatus({ status: 'Planned', scheduledFor: '2026-10-27' }, today)).toBe('Due soon');
    expect(maintenanceDisplayStatus({ status: 'Planned', scheduledFor: '2026-11-10' }, today)).toBe('Due soon');
    expect(maintenanceDisplayStatus({ status: 'Planned', scheduledFor: '2026-11-11' }, today)).toBe('Planned');
    expect(maintenanceDisplayStatus({ status: 'Planned', scheduledFor: null }, today)).toBe('Planned');
    expect(maintenanceDisplayStatus({ status: 'In progress', scheduledFor: '2026-10-01' }, today)).toBe('In progress');
    expect(maintenanceDisplayStatus({ status: 'Completed', scheduledFor: '2026-10-01' }, today)).toBe('Completed');
  });

  it('keeps the next-due of the latest completed job per vehicle and category, unless already booked', () => {
    const older = job({ status: 'Completed', completedAt: '2026-01-10', nextDueAt: '2026-04-10' });
    const latest = job({ status: 'Completed', completedAt: '2026-07-10', nextDueAt: '2026-11-05' });
    const tyres = job({ category: 'Tyres', status: 'Completed', completedAt: '2026-05-01', nextDueAt: '2026-10-20' });
    const van = job({ vehicle: VAN, status: 'Completed', completedAt: '2026-09-01', nextDueAt: '2027-03-01' });
    expect(outstandingNextDue([older, latest, tyres, van]).map((i) => i.id)).toEqual([latest.id, tyres.id, van.id]);

    const booked = job({ status: 'Planned', scheduledFor: '2026-11-04' });
    const cancelled = job({ category: 'Tyres', status: 'Cancelled' });
    expect(outstandingNextDue([older, latest, tyres, booked, cancelled]).map((i) => i.id)).toEqual([tyres.id]);
  });
});

describe('maintenance reminders', () => {
  const today = '2026-10-27';
  const keys = (items: MaintenanceDto[], odometers: Record<number, number> = {}) =>
    activeMaintenanceReminders(items, odometers, today).map((r) => r.key);

  it('remind services and inspections a week ahead by default, other work only when asked', () => {
    expect(defaultReminderDays('Service')).toBe(7);
    expect(defaultReminderDays('Inspection')).toBe(7);
    expect(defaultReminderDays('Repair')).toBeNull();
  });

  it('reminds of planned work inside its window, then again once the date passes', () => {
    const inWindow = job({ reminderDays: 7, scheduledFor: '2026-11-03' });
    const tooEarly = job({ reminderDays: 7, scheduledFor: '2026-11-04' });
    const late = job({ reminderDays: 1, scheduledFor: '2026-10-25' });
    const off = job({ reminderDays: null, scheduledFor: '2026-10-28' });
    const started = job({ reminderDays: 7, status: 'In progress', scheduledFor: '2026-10-28' });
    expect(keys([inWindow, tooEarly, late, off, started])).toEqual([
      `planned:${late.id}:2026-10-25:overdue`,
      `planned:${inWindow.id}:2026-11-03:upcoming`,
    ]);
  });

  it('moves on to the next-due date and km once the work is done', () => {
    const done = job({
      reminderDays: 14,
      status: 'Completed',
      completedAt: '2026-05-01',
      nextDueAt: '2026-11-05',
      nextDueKm: 50_000,
    });
    expect(keys([done], { [CAR.id]: 48_999 })).toEqual([`next-date:${done.id}:2026-11-05:upcoming`]);
    // A km reminder counts as due now, so it sorts ahead of a date still days away.
    expect(keys([done], { [CAR.id]: 49_000 })).toEqual([
      `next-km:${done.id}:50000:upcoming`,
      `next-date:${done.id}:2026-11-05:upcoming`,
    ]);
    expect(keys([done], { [CAR.id]: 50_400 })).toContain(`next-km:${done.id}:50000:overdue`);

    // Booking the next service hands the reminding over to that job.
    const next = job({ reminderDays: 7, scheduledFor: '2026-11-20' });
    expect(keys([done, next], { [CAR.id]: 50_400 })).toEqual([]);
  });

  it('words each reminder for the bell', () => {
    const planned = job({ title: 'Annual inspection', category: 'Inspection', reminderDays: 7, scheduledFor: '2026-11-03' });
    const done = job({ title: 'Service', reminderDays: 7, status: 'Completed', completedAt: '2026-05-01', nextDueAt: '2026-10-20', nextDueKm: 50_000 });
    const messages = activeMaintenanceReminders([planned, done], { [CAR.id]: 49_500 }, today).map(reminderMessage);
    expect(messages).toEqual([
      'Service for KDA 123A was due on Oct 20, 2026 (7 days overdue)',
      'Service for KDA 123A is due at 50,000 km (last reading 49,500 km)',
      'Inspection for KDA 123A is planned on Nov 3, 2026 (in 7 days) — Annual inspection',
    ]);
    const todayJob = job({ reminderDays: 0, scheduledFor: today, title: 'Oil change' });
    expect(reminderMessage(activeMaintenanceReminders([todayJob], {}, today)[0]!)).toBe(
      'Service for KDA 123A is planned today — Oil change',
    );
  });
});

describe('fleet validation', () => {
  it('fills defaults on create', () => {
    const parsed = fuelLogCreateSchema.parse({ vehicleId: 1, filledAt: '2026-10-27T08:00:00Z', litres: 40 });
    expect(parsed).toMatchObject({ currency: 'USD', fuelType: 'Petrol', fullTank: true });

    const job = maintenanceCreateSchema.parse({ vehicleId: 1, title: 'Oil change' });
    expect(job).toMatchObject({ kind: 'Scheduled', category: 'Service', status: 'Planned', currency: 'USD' });
    // Left out, the reminder follows the category on the server.
    expect(job).not.toHaveProperty('reminderDays');
  });

  it('leaves fields out of an update instead of resetting them to defaults', () => {
    expect(fuelLogUpdateSchema.parse({ litres: 12 })).toEqual({ litres: 12 });
    expect(maintenanceUpdateSchema.parse({ status: 'Completed' })).toEqual({ status: 'Completed' });
  });

  it('rejects bad input', () => {
    expect(fuelLogCreateSchema.safeParse({ vehicleId: 1, filledAt: '2026-10-27', litres: 0 }).success).toBe(false);
    expect(fuelLogCreateSchema.safeParse({ vehicleId: 1, filledAt: 'soon', litres: 5 }).success).toBe(false);
    expect(fuelLogCreateSchema.safeParse({ vehicleId: 1, filledAt: '2026-10-27', litres: 5, fuelType: 'Coal' }).success).toBe(false);
    expect(maintenanceCreateSchema.safeParse({ vehicleId: 1, title: 'x', scheduledFor: '27/10/2026' }).success).toBe(false);
    expect(maintenanceCreateSchema.safeParse({ vehicleId: 1, title: '  ' }).success).toBe(false);
    expect(maintenanceUpdateSchema.safeParse({}).success).toBe(false);
    expect(maintenanceUpdateSchema.safeParse({ status: 'Scheduled' }).success).toBe(false);
    expect(maintenanceUpdateSchema.safeParse({ kind: 'Sometimes' }).success).toBe(false);
    expect(maintenanceUpdateSchema.safeParse({ reminderDays: 5 }).success).toBe(false);
    expect(maintenanceUpdateSchema.safeParse({ reminderDays: null }).success).toBe(true);
  });
});
