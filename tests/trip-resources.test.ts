import { beforeEach, describe, expect, it, vi } from 'vitest';

const { tx, transaction } = vi.hoisted(() => {
  const tx = {
    trip: { findUnique: vi.fn(), update: vi.fn() },
    tripResource: { update: vi.fn(), create: vi.fn(), delete: vi.fn() },
    tripItineraryItem: { createManyAndReturn: vi.fn(), update: vi.fn() },
    tripItemTraveler: { createMany: vi.fn(), deleteMany: vi.fn() },
    tripItemResource: { createMany: vi.fn(), deleteMany: vi.fn() },
    tripDayLog: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    vendorService: { findUnique: vi.fn() },
    vehicle: { findUnique: vi.fn() },
  };
  return { tx, transaction: vi.fn((fn: (client: typeof tx) => unknown) => fn(tx)) };
});

vi.mock('server-only', () => ({}));
vi.mock('../lib/trip-notifications', () => ({ syncCrewGapNotifications: vi.fn() }));
vi.mock('../lib/prisma', () => ({ prisma: { $transaction: transaction, ...tx } }));

import { removeServiceAt, resourcePatch } from '../app/modules/trip-planning/[tripId]/_components/service-picker';
import type { EditorState } from '../app/modules/trip-planning/[tripId]/editor-state';
import {
  type TripDayLogSummary,
  type TripResourceSummary,
  billingCsv,
  buildBillingLog,
  coversDate,
  csvCell,
  dayTotals,
  daysInRange,
  distanceKm,
  inPool,
  poolCrewFilter,
  resourceKind,
  resourceUsage,
  shiftHours,
  unverifiedResources,
  vehicleTypesForClass,
  verificationNotice,
} from '../lib/trip-resource-model';
import { reconcileTripResources, saveTripDayLog, stageTripResource } from '../lib/trip-resources';
import { addTripItems, updateTrip } from '../lib/trips';
import { tripResourceReconcileSchema } from '../lib/validation';

function resource(id: number, extra: Partial<TripResourceSummary> = {}): TripResourceSummary {
  return {
    id,
    vendorId: 4,
    vendorName: 'A-1 Logistics',
    productId: 100 + id,
    serviceName: 'SUV Standard + Security Driver - Full Day - Within Kampala',
    serviceCode: 'UGA-HIR-SUV-STA-FD-EBB',
    category: 'Vehicle Hire',
    subCategory: 'Full Day',
    serviceClass: 'SUV',
    unitOfMeasure: 'Per day',
    kind: 'vehicle',
    startDate: '2026-11-08',
    endDate: '2026-11-11',
    quantity: 1,
    resolution: null,
    billableHours: null,
    startOdometer: null,
    endOdometer: null,
    resolvedAt: null,
    resolvedBy: null,
    ...extra,
  };
}

const days = [
  { id: 1, dayNumber: 1, dateKey: '2026-11-08' },
  { id: 2, dayNumber: 2, dateKey: '2026-11-09' },
  { id: 3, dayNumber: 3, dateKey: '2026-11-10' },
  { id: 4, dayNumber: 4, dateKey: '2026-11-11' },
];

const arrival = resource(2, {
  serviceName: 'Airport Arrival Assistance - Kampala (EBB)',
  serviceCode: 'UGA-APT-ARR-EBB',
  category: 'Airport Services',
  subCategory: 'Arrival & Departure Assistance',
  serviceClass: 'Facilitator',
  unitOfMeasure: 'Per traveler',
  kind: 'personnel',
  quantity: 4,
});

describe('the staged pool', () => {
  it('sorts a staged service into a vehicle, people, or neither', () => {
    expect(resourceKind('Vehicle Hire')).toBe('vehicle');
    expect(resourceKind('Transfers')).toBe('vehicle');
    expect(resourceKind('Personnel')).toBe('personnel');
    expect(resourceKind('Airport Services')).toBe('personnel');
    expect(resourceKind('Surcharges')).toBe('other');
    expect(resourceKind(null)).toBe('other');
  });

  it('counts staged days inclusively and refuses a range that runs backwards', () => {
    expect(daysInRange('2026-11-08', '2026-11-11')).toBe(4);
    expect(daysInRange('2026-11-08', '2026-11-08')).toBe(1);
    expect(daysInRange('2026-11-11', '2026-11-08')).toBeNull();
    expect(daysInRange('2026-02-31', '2026-03-02')).toBeNull();
    expect(daysInRange(null, '2026-11-08')).toBeNull();
  });

  it('covers its own dates, and the whole trip when staged without any', () => {
    expect(coversDate(resource(1), '2026-11-08')).toBe(true);
    expect(coversDate(resource(1), '2026-11-12')).toBe(false);
    expect(coversDate(resource(1, { startDate: null, endDate: null }), '2027-01-01')).toBe(true);
  });

  it('shows the days a per-day resource still has left once events use it', () => {
    const items = [
      { dayId: 1, resourceIds: [1] },
      // Two events on the same day use one day of it.
      { dayId: 1, resourceIds: [1] },
    ];
    expect(resourceUsage(resource(1), items, days)).toMatchObject({
      state: 'assigned',
      eventCount: 2,
      usedDayIds: [1],
      stagedDays: 4,
      remainingDays: 3,
    });
  });

  it('leaves a resource no event used unassigned until the Controller rules on it', () => {
    expect(resourceUsage(arrival, [], days).state).toBe('unassigned');
    expect(resourceUsage({ ...arrival, resolution: 'unused' }, [], days).state).toBe('unused');
    expect(resourceUsage({ ...arrival, resolution: 'used' }, [], days).state).toBe('kept');
    // An event picking it up later wins over an earlier "unused".
    expect(resourceUsage({ ...arrival, resolution: 'unused' }, [{ dayId: 1, resourceIds: [2] }], days).state).toBe('assigned');
  });

  it('flags only what is staged, on no event, and not yet verified', () => {
    const pool = [resource(1), arrival, resource(3, { resolution: 'unused' }), resource(4, { resolution: 'used' })];
    const pending = unverifiedResources(pool, [{ dayId: 1, resourceIds: [1] }]);
    expect(pending.map((r) => r.id)).toEqual([2]);
    expect(verificationNotice(1)).toBe('1 unused resource needs verification');
    expect(verificationNotice(3)).toBe('3 unused resources need verification');
  });
});

describe('who the pool puts on a day', () => {
  it('maps a service class onto the fleet register\'s vehicle types', () => {
    expect(vehicleTypesForClass('SUV')).toEqual(['SUV', 'Armoured']);
    expect(vehicleTypesForClass('Safari Land Cruiser')).toEqual(['SUV', 'Armoured']);
    expect(vehicleTypesForClass('Multi-Passenger Van')).toEqual(['Van']);
    expect(vehicleTypesForClass('Coaster Bus')).toEqual(['Van']);
    expect(vehicleTypesForClass('Sedan')).toEqual(['Sedan']);
    expect(vehicleTypesForClass('Kenya Police')).toBeNull();
  });

  it('offers a vendor\'s drivers and matching vehicles on the days its vehicle service is staged', () => {
    const filter = poolCrewFilter([resource(1)], '2026-11-09');
    expect(inPool(filter, 'driver', { vendorId: 4 })).toBe(true);
    expect(inPool(filter, 'vehicle', { vendorId: 4, vehicleType: 'SUV' })).toBe(true);
    expect(inPool(filter, 'vehicle', { vendorId: 4, vehicleType: 'Sedan' })).toBe(false);
    // Another vendor's, or nobody's, is not in the pool.
    expect(inPool(filter, 'vehicle', { vendorId: 9, vehicleType: 'SUV' })).toBe(false);
    expect(inPool(filter, 'driver', { vendorId: null })).toBe(false);
    // A vehicle service doesn't put CPOs on offer; a personnel service does.
    expect(inPool(filter, 'officer', { vendorId: 4 })).toBe(false);
    expect(inPool(poolCrewFilter([resource(5, { category: 'Personnel', kind: 'personnel' })], '2026-11-09'), 'officer', { vendorId: 4 })).toBe(true);
  });

  it('offers no one outside the staged dates, or from a resource verified unused', () => {
    expect(inPool(poolCrewFilter([resource(1)], '2026-11-12'), 'driver', { vendorId: 4 })).toBe(false);
    expect(inPool(poolCrewFilter([resource(1, { resolution: 'unused' })], '2026-11-09'), 'driver', { vendorId: 4 })).toBe(false);
  });

  it('opens the vendor\'s whole fleet when a staged service names no vehicle class', () => {
    const filter = poolCrewFilter([resource(1), resource(2, { category: 'Escort', serviceClass: 'Kenya Police' })], '2026-11-09');
    expect(inPool(filter, 'vehicle', { vendorId: 4, vehicleType: 'Sedan' })).toBe(true);
  });
});

describe('daily shifts and odometers', () => {
  it('adds up a shift, including one that runs past midnight', () => {
    expect(shiftHours('07:00', '19:30')).toBe(12.5);
    expect(shiftHours('22:00', '02:15')).toBe(4.25);
    expect(shiftHours('07:00', null)).toBeNull();
    expect(shiftHours('7am', '19:30')).toBeNull();
  });

  it('measures kilometres only from two readings that go forwards', () => {
    expect(distanceKm(45210, 45395)).toBe(185);
    expect(distanceKm(45210, null)).toBeNull();
    expect(distanceKm(45395, 45210)).toBeNull();
  });

  it('totals a day and counts the lines still open', () => {
    const log = (id: number, extra: Partial<TripDayLogSummary>): TripDayLogSummary => ({
      id,
      dayId: 1,
      kind: 'driver',
      subjectId: id,
      label: `Line ${id}`,
      shiftStart: null,
      shiftEnd: null,
      startOdometer: null,
      endOdometer: null,
      ...extra,
    });
    expect(
      dayTotals([
        log(1, { shiftStart: '07:00', shiftEnd: '19:30' }),
        log(2, { kind: 'officer', shiftStart: '08:00', shiftEnd: '13:00' }),
        log(3, { kind: 'officer', shiftStart: '08:00' }),
        log(4, { kind: 'vehicle', startOdometer: 45210, endOdometer: 45395 }),
      ]),
    ).toEqual({ hours: 17.5, km: 185, open: 1 });
  });
});

describe('the billing log', () => {
  const trip = {
    days,
    items: [
      { dayId: 1, resourceIds: [1] },
      { dayId: 2, resourceIds: [1] },
    ],
    resources: [
      resource(1),
      { ...arrival, resolution: 'unused' as const },
      resource(3, { serviceName: 'Kept SUV', resolution: 'used', billableHours: 6.5, startOdometer: 100, endOdometer: 160 }),
      resource(4, { serviceName: 'Forgotten SUV' }),
    ],
    dayLogs: [
      { id: 1, dayId: 1, kind: 'driver' as const, subjectId: 5, label: 'Abebe T.', shiftStart: '07:00', shiftEnd: '19:30', startOdometer: null, endOdometer: null },
      { id: 2, dayId: 1, kind: 'vehicle' as const, subjectId: 30, label: 'UAB 123X', shiftStart: null, shiftEnd: null, startOdometer: 45210, endOdometer: 45395 },
    ],
  };

  it('bills what was used or kept, and leaves out what was verified unused', () => {
    const log = buildBillingLog(trip);
    expect(log.services.map((line) => [line.serviceName, line.status])).toEqual([
      ['SUV Standard + Security Driver - Full Day - Within Kampala', 'Assigned'],
      ['Kept SUV', 'Kept and logged'],
      ['Forgotten SUV', 'Needs verification'],
    ]);
    expect(log.services[0]).toMatchObject({ stagedDays: 4, usedDays: 2, usedOn: 'Day 1, Day 2', eventCount: 2 });
    expect(log.services[1]).toMatchObject({ billableHours: 6.5, km: 60 });
    expect(log.notBilled.map((line) => line.serviceName)).toEqual(['Airport Arrival Assistance - Kampala (EBB)']);
    expect(log.days.map((line) => [line.label, line.hours, line.km])).toEqual([
      ['Abebe T.', 12.5, null],
      ['UAB 123X', null, 185],
    ]);
    expect(log.totals).toEqual({ hours: 12.5, km: 185, keptHours: 6.5, keptKm: 60 });
  });

  it('exports one flat table, without the unused resource', () => {
    const csv = billingCsv(buildBillingLog(trip), { reference: 'MF-UGA-NOV-0006', client: 'Mastercard Foundation' });
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[0]).toContain('Trip,Client,Section,Day,Date,Vendor,Item');
    expect(lines).toHaveLength(1 + 3 + 2);
    expect(csv).not.toContain('Arrival Assistance');
    expect(lines.find((line) => line.includes('UAB 123X'))).toContain(',Odometer,Day 1,2026-11-08,');
    expect(lines.find((line) => line.includes('UAB 123X'))).toContain('45210,45395,185,Logged');
  });

  it('never lets a name be read as a spreadsheet formula', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvCell('Nairobi, Kenya')).toBe('"Nairobi, Kenya"');
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(null)).toBe('');
  });
});

describe('picking an event\'s service from the pool', () => {
  const editor = (extra: Partial<EditorState> = {}) =>
    ({ category: 'transportation', details: {}, resourceIds: [], ...extra }) as EditorState;

  it('puts the service on the event, ties it to the pool entry, and sets the transport type', () => {
    expect(resourcePatch(editor(), resource(1))).toEqual({
      details: {
        service: 'SUV Standard + Security Driver - Full Day - Within Kampala',
        serviceCode: 'UGA-HIR-SUV-STA-FD-EBB',
        mode: 'Full Day Hire',
      },
      resourceIds: [1],
    });
  });

  it('ties an event that already names the service without adding it twice', () => {
    const named = editor({ details: { service: arrival.serviceName, serviceCode: arrival.serviceCode! } });
    const patch = resourcePatch(named, arrival);
    expect(patch.details).toEqual(named.details);
    expect(patch.resourceIds).toEqual([2]);
    expect(resourcePatch(editor({ resourceIds: [2] }), arrival)).toEqual({});
  });

  it('unties the pool entry when its service is taken off the event', () => {
    const first = { ...editor(), ...resourcePatch(editor(), resource(1)) } as EditorState;
    const both = { ...first, ...resourcePatch(first, arrival) } as EditorState;
    expect(both.resourceIds).toEqual([1, 2]);
    const patch = removeServiceAt(both, 0, [resource(1), arrival]);
    expect(patch.resourceIds).toEqual([2]);
    expect(patch.details).toMatchObject({ service: arrival.serviceName, serviceCode: 'UGA-APT-ARR-EBB' });
  });
});

// ── The server's side of it ────────────────────────────────────────────────

const now = new Date('2026-11-08T00:00:00Z');

function resourceRow(id: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    vendorId: 4,
    productId: 100 + id,
    vendorName: 'A-1 Logistics',
    serviceName: `Service ${id}`,
    serviceCode: `SVC-${id}`,
    category: 'Vehicle Hire',
    serviceClass: 'SUV',
    unitOfMeasure: 'Per day',
    startDate: '2026-11-08',
    endDate: '2026-11-11',
    quantity: 1,
    resolution: null,
    billableHours: null,
    startOdometer: null,
    endOdometer: null,
    resolvedAt: null,
    resolvedBy: null,
    product: { subCategory: 'Full Day' },
    ...extra,
  };
}

function tripRecord(extra: Record<string, unknown> = {}) {
  return {
    id: 7,
    reference: 'MF-UGA-NOV-0006',
    trackingCode: 'LA-2026-0006',
    customerId: 3,
    sourceQuoteId: null,
    createdById: 1,
    ownerId: null,
    title: 'Kampala visit',
    description: null,
    status: 'Active',
    country: 'Uganda',
    startDate: now,
    endDate: now,
    currency: 'USD',
    notes: null,
    createdAt: now,
    updatedAt: now,
    customer: { id: 3, name: 'Mastercard Foundation', company: null, email: null },
    travelers: [],
    createdBy: { id: 1, name: 'Ops', email: 'ops@example.test' },
    owner: null,
    sourceQuote: null,
    items: [],
    days: [{ id: 1, tripId: 7, dateKey: '2026-11-08', dayNumber: 1, title: null, summary: null }],
    resources: [resourceRow(1), resourceRow(2)],
    dayLogs: [],
    ...extra,
  };
}

function eventUsing(resourceId: number) {
  return {
    id: 50,
    tripId: 7,
    dayId: 1,
    position: 0,
    itemType: 'car',
    category: 'transportation',
    description: 'Airport pick-up',
    quantity: 1,
    unitPrice: null,
    completedAt: null,
    scheduledAt: null,
    endsAt: null,
    reminderAt: null,
    driverId: null,
    officerId: null,
    vehicleId: null,
    details: null,
    resources: [{ resourceId }],
  };
}

beforeEach(() => {
  for (const delegate of Object.values(tx)) {
    for (const fn of Object.values(delegate)) fn.mockReset();
  }
});

describe('completing a trip', () => {
  const complete = () => updateTrip({ id: 7, userId: 1, isAdmin: false, input: { status: 'Completed' } });

  it('is refused while a staged resource no event used is unverified', async () => {
    tx.trip.findUnique.mockResolvedValue(tripRecord({ items: [eventUsing(1)] }));
    expect(await complete()).toEqual({
      error: '1 unused resource needs verification before this trip can be completed',
      status: 409,
    });
    expect(tx.trip.update).not.toHaveBeenCalled();
  });

  it('goes through once every leftover has a verdict', async () => {
    tx.trip.findUnique.mockResolvedValue(
      tripRecord({ items: [eventUsing(1)], resources: [resourceRow(1), resourceRow(2, { resolution: 'unused' })] }),
    );
    const result = await complete();
    expect(result).not.toHaveProperty('error');
    expect(tx.trip.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'Completed' }) }));
  });

  it('does not hold up any other status change', async () => {
    tx.trip.findUnique.mockResolvedValue(tripRecord());
    const result = await updateTrip({ id: 7, userId: 1, isAdmin: false, input: { status: 'Cancelled' } });
    expect(result).not.toHaveProperty('error');
  });
});

describe('reconciling unused resources', () => {
  const reconcile = (verdicts: Parameters<typeof reconcileTripResources>[0]['verdicts'], complete = true) =>
    reconcileTripResources({ tripId: 7, userId: 1, isAdmin: false, verdicts, complete });

  it('saves each verdict and completes the trip in one step', async () => {
    tx.trip.findUnique.mockResolvedValue(tripRecord());
    const result = await reconcile([
      { resourceId: 1, resolution: 'unused', billableHours: 3 },
      { resourceId: 2, resolution: 'used', billableHours: 6.5, startOdometer: 100, endOdometer: 160 },
    ]);
    expect(result).toMatchObject({ resolved: 2, completed: true, previousStatus: 'Active' });
    // "Unused" carries no figures onto the bill, whatever was sent with it.
    expect(tx.tripResource.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({ resolution: 'unused', billableHours: null, startOdometer: null, endOdometer: null, resolvedById: 1 }),
    });
    expect(tx.tripResource.update).toHaveBeenCalledWith({
      where: { id: 2 },
      data: expect.objectContaining({ resolution: 'used', billableHours: 6.5, startOdometer: 100, endOdometer: 160 }),
    });
    expect(tx.trip.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { status: 'Completed' } });
  });

  it('will not complete with a leftover still unanswered, and saves nothing', async () => {
    tx.trip.findUnique.mockResolvedValue(tripRecord());
    expect(await reconcile([{ resourceId: 1, resolution: 'unused' }])).toEqual({
      error: '1 unused resource needs verification before this trip can be completed',
      status: 409,
    });
    expect(tx.tripResource.update).not.toHaveBeenCalled();
    expect(tx.trip.update).not.toHaveBeenCalled();
  });

  it('skips a resource an event has picked up since the dialog opened', async () => {
    tx.trip.findUnique.mockResolvedValue(tripRecord({ items: [eventUsing(1)] }));
    const result = await reconcile([
      { resourceId: 1, resolution: 'unused' },
      { resourceId: 2, resolution: 'unused' },
    ]);
    expect(result).toMatchObject({ resolved: 1, completed: true });
    expect(tx.tripResource.update).toHaveBeenCalledTimes(1);
  });

  it('refuses a resource from another trip\'s pool', async () => {
    tx.trip.findUnique.mockResolvedValue(tripRecord());
    expect(await reconcile([{ resourceId: 99, resolution: 'unused' }])).toMatchObject({ status: 400 });
  });

  it('wants both odometer readings or neither, going forwards', () => {
    const errors = (verdict: Record<string, unknown>) => {
      const parsed = tripResourceReconcileSchema.safeParse({ verdicts: [{ resourceId: 1, resolution: 'used', ...verdict }] });
      return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
    };
    expect(errors({})).toEqual([]);
    expect(errors({ billableHours: 6.5 })).toEqual([]);
    expect(errors({ startOdometer: 100, endOdometer: 160 })).toEqual([]);
    expect(errors({ startOdometer: 100 })).toEqual(['Give both odometer readings, or neither']);
    expect(errors({ startOdometer: 160, endOdometer: 100 })).toEqual(['The end odometer is behind the start']);
  });
});

describe('staging and using the pool', () => {
  it('stages only from an approved vendor\'s own catalog, copying the names as they are', async () => {
    tx.trip.findUnique.mockResolvedValue(tripRecord());
    const stage = () =>
      stageTripResource({ tripId: 7, userId: 1, isAdmin: false, input: { vendorId: 4, productId: 101, startDate: '2026-11-08', endDate: '2026-11-11', quantity: 2 } });

    tx.vendorService.findUnique.mockResolvedValue(null);
    expect(await stage()).toMatchObject({ status: 400, error: "That service is not in the vendor's catalog" });

    const product = { name: 'SUV Standard', sku: 'UGA-HIR-SUV', category: 'Vehicle Hire', serviceClass: 'SUV', unitOfMeasure: 'Per day', archived: false };
    tx.vendorService.findUnique.mockResolvedValue({ vendor: { name: 'A-1 Logistics', status: 'Suspended' }, product });
    expect(await stage()).toMatchObject({ status: 400, error: 'A-1 Logistics is not an approved vendor' });
    expect(tx.tripResource.create).not.toHaveBeenCalled();

    tx.vendorService.findUnique.mockResolvedValue({ vendor: { name: 'A-1 Logistics', status: 'Approved' }, product });
    expect(await stage()).not.toHaveProperty('error');
    expect(tx.tripResource.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tripId: 7, vendorName: 'A-1 Logistics', serviceName: 'SUV Standard', serviceCode: 'UGA-HIR-SUV', quantity: 2, createdById: 1 }),
    });
  });

  it('ties a new event to the pool entries its services came from', async () => {
    tx.trip.findUnique.mockResolvedValue(tripRecord());
    tx.tripItineraryItem.createManyAndReturn.mockResolvedValue([{ id: 60, position: 0 }]);
    const add = (resourceIds: number[]) =>
      addTripItems({ tripId: 7, userId: 1, isAdmin: false, items: [{ description: 'Airport pick-up', quantity: 1, resourceIds }] });

    expect(await add([1, 1, 2])).not.toHaveProperty('error');
    expect(tx.tripItemResource.createMany).toHaveBeenCalledWith({
      data: [
        { itemId: 60, resourceId: 1 },
        { itemId: 60, resourceId: 2 },
      ],
    });
    // Not from this trip's pool.
    expect(await add([99])).toMatchObject({ status: 400 });
  });

  it('keeps times on people and readings on vehicles, and drops a line left empty', async () => {
    tx.trip.findUnique.mockResolvedValue(tripRecord());
    tx.vehicle.findUnique.mockResolvedValue({ registration: 'UAB 123X' });
    tx.tripDayLog.findFirst.mockResolvedValue(null);
    const save = (input: Parameters<typeof saveTripDayLog>[0]['input']) =>
      saveTripDayLog({ tripId: 7, dayId: 1, userId: 1, isAdmin: false, input });

    await save({ kind: 'vehicle', subjectId: 30, startOdometer: 45210, shiftStart: '07:00' });
    expect(tx.tripDayLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: 'vehicle', vehicleId: 30, label: 'UAB 123X', startOdometer: 45210, shiftStart: null }),
    });

    tx.tripDayLog.findFirst.mockResolvedValue({ id: 8 });
    await save({ kind: 'vehicle', subjectId: 30 });
    expect(tx.tripDayLog.delete).toHaveBeenCalledWith({ where: { id: 8 } });

    expect(await saveTripDayLog({ tripId: 7, dayId: 99, userId: 1, isAdmin: false, input: { kind: 'vehicle', subjectId: 30 } })).toMatchObject({ status: 404 });
  });
});
