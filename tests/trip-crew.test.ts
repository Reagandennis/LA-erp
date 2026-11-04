import { beforeEach, describe, expect, it, vi } from 'vitest';

const { driverFindMany, officerFindMany, vehicleFindMany, assignmentFindMany } = vi.hoisted(() => ({
  driverFindMany: vi.fn(),
  officerFindMany: vi.fn(),
  vehicleFindMany: vi.fn(),
  assignmentFindMany: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('../lib/prisma', () => ({
  prisma: {
    driver: { findMany: driverFindMany },
    officer: { findMany: officerFindMany },
    vehicle: { findMany: vehicleFindMany },
    tripAssignment: { findMany: assignmentFindMany },
  },
}));

import { crewGapLabel, crewGaps } from '../lib/crew-gaps';
import { listCrewOptions } from '../lib/trip-crew';
import { tripItineraryItemAddSchema } from '../lib/validation';

describe('listCrewOptions', () => {
  beforeEach(() => {
    driverFindMany.mockResolvedValue([
      { id: 1, name: 'Amina Driver', phone: '0700 000 001', status: 'Available' },
      { id: 2, name: 'Brian Driver', phone: null, status: 'Off duty' },
    ]);
    officerFindMany.mockResolvedValue([
      { id: 7, name: 'Chege CPO', callSign: 'Lion 2', grade: 'CPO', phone: null, status: 'Available' },
    ]);
    vehicleFindMany.mockResolvedValue([
      { id: 30, registration: 'KDA 001A', make: 'Toyota', model: 'Land Cruiser', type: 'SUV', status: 'Available' },
    ]);
    assignmentFindMany.mockResolvedValue([
      // On this trip: offered first.
      { tripId: 9, driverId: 1, officerId: null, vehicleId: 30, trip: { reference: 'TR-2026-0009' } },
      // Active on another trip: a heads-up, not a block.
      { tripId: 4, driverId: 2, officerId: 7, vehicleId: null, trip: { reference: 'TR-2026-0004' } },
    ]);
  });

  it('marks who is on this trip and who is busy on another', async () => {
    const options = await listCrewOptions(9);
    expect(options.drivers).toEqual([
      { id: 1, label: 'Amina Driver', hint: '0700 000 001', status: 'Available', onTrip: true, busyOn: null },
      { id: 2, label: 'Brian Driver', hint: null, status: 'Off duty', onTrip: false, busyOn: 'TR-2026-0004' },
    ]);
    expect(options.officers[0]).toMatchObject({ hint: 'CPO · Lion 2', busyOn: 'TR-2026-0004' });
    expect(options.vehicles[0]).toMatchObject({ label: 'KDA 001A', hint: 'Toyota Land Cruiser · SUV', onTrip: true });
  });

  it('only offers people still on the register', async () => {
    await listCrewOptions(9);
    expect(driverFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { retiredAt: null } }));
    expect(officerFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { retiredAt: null } }));
  });
});

describe('adding crewed events', () => {
  const event = (extra: Record<string, unknown>) => ({ items: [{ description: 'Airport pick-up', quantity: 1, ...extra }] });
  const errors = (body: unknown) => {
    const result = tripItineraryItemAddSchema.safeParse(body);
    return result.success ? [] : result.error.issues.map((issue) => issue.message);
  };

  it('saves transport and flights with or without a driver, vehicle or CPO', () => {
    expect(errors(event({ category: 'transportation' }))).toEqual([]);
    expect(errors(event({ category: 'flight', driverId: 1 }))).toEqual([]);
    expect(errors(event({ category: 'transportation', driverId: 1, vehicleId: 30 }))).toEqual([]);
    expect(errors(event({ category: 'flight', driverId: 1, vehicleId: 30, officerId: 7 }))).toEqual([]);
  });

  it('leaves other kinds of event alone', () => {
    expect(errors(event({ category: 'activity' }))).toEqual([]);
    expect(errors(event({}))).toEqual([]);
  });
});

describe('crew gaps', () => {
  it('names what a movement still lacks, in order', () => {
    expect(crewGaps({ category: 'transportation' })).toEqual(['driver', 'vehicle', 'CPO']);
    expect(crewGaps({ category: 'flight', driverId: 1, vehicleId: 30 })).toEqual(['CPO']);
    expect(crewGaps({ category: 'transportation', driverId: 1, vehicleId: 30, officerId: 7 })).toEqual([]);
  });

  it('counts an imported record’s typed-in driver and vehicle', () => {
    expect(crewGaps({ category: 'transportation', details: { driverName: 'Peter', vehicle: 'KDA 123A' } })).toEqual(['CPO']);
    expect(crewGaps({ category: 'transportation', details: { driverName: '  ' } })).toEqual(['driver', 'vehicle', 'CPO']);
  });

  it('has nothing to say about events that take no crew', () => {
    expect(crewGaps({ category: 'activity' })).toEqual([]);
    expect(crewGaps({ category: null })).toEqual([]);
  });

  it('reads as a sentence', () => {
    expect(crewGapLabel(['driver', 'vehicle', 'CPO'])).toBe('No driver, vehicle or CPO assigned');
    expect(crewGapLabel(['vehicle', 'CPO'])).toBe('No vehicle or CPO assigned');
    expect(crewGapLabel(['CPO'])).toBe('No CPO assigned');
    expect(crewGapLabel([])).toBe('');
  });
});
