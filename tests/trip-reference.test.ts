import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { listCustomers, listReferenceDefaults, peekNextReferenceNumber, requireModuleRequest } = vi.hoisted(() => ({
  listCustomers: vi.fn(),
  listReferenceDefaults: vi.fn(),
  peekNextReferenceNumber: vi.fn(),
  requireModuleRequest: vi.fn(),
}));

vi.mock('../lib/request-auth', () => ({ requireModuleRequest }));
vi.mock('../lib/customers', () => ({ listCustomers }));
vi.mock('../lib/trips', () => ({
  listOwnerCandidates: vi.fn(async () => []),
  listTravelerOptions: vi.fn(async () => []),
  listReferenceDefaults,
  peekNextReferenceNumber,
}));

import { GET as formOptions } from '../app/api/trips/form-options/route';
import {
  buildTripReference,
  parseTripReference,
  referenceDefaults,
  referenceMonth,
  suggestClientCode,
} from '../lib/trip-reference';
import { tripCreateSchema } from '../lib/validation';

describe('trip references', () => {
  it('read the client code and country from the references trips already have', () => {
    expect(parseTripReference('TKGM-ETH-OCT-2660')).toEqual({ clientCode: 'TKGM', country: 'Ethiopia' });
    expect(parseTripReference('MCF-X-KEN-JAN-1600')).toEqual({ clientCode: 'MCF', country: 'Kenya' });
    // Codes from before the naming master settled them.
    expect(parseTripReference('ATC-TZ-DEC-1563')?.country).toBe('Tanzania');
    expect(parseTripReference('BRG-SA-OCT-1496')?.country).toBe('South Africa');
    expect(parseTripReference('ATC-KEN-JULY-1344')?.country).toBe('Kenya');
    expect(parseTripReference('Admin movement')).toBeNull();
    expect(parseTripReference('TR-2026-0001')).toBeNull();
  });

  it("know each client's usual code and country, the most recent of equals", () => {
    const defaults = referenceDefaults([
      { customerId: 1, reference: 'CVA-KEN-OCT-2600' },
      { customerId: 1, reference: 'CV-ETH-SEP-2500' },
      { customerId: 1, reference: 'CV-KEN-AUG-2400' },
      { customerId: 2, reference: 'Internal movement' },
    ]);
    expect(defaults.get(1)).toEqual({ clientCode: 'CV', country: 'Kenya' });
    expect(defaults.has(2)).toBe(false);
  });

  it("start a new client's code from their initials", () => {
    expect(suggestClientCode('Mastercard Foundation')).toBe('MF');
    expect(suggestClientCode('Tulu Kapi Gold Mine S.C.')).toBe('TKGM');
    expect(suggestClientCode('Bloomberg')).toBe('BLOO');
  });

  it('take the month the trip starts, or this month without a date', () => {
    expect(referenceMonth('2026-06-01', '2026-10-27')).toBe('JUN');
    expect(referenceMonth(null, '2026-10-27')).toBe('OCT');
  });

  it('end with at least four digits', () => {
    expect(buildTripReference({ clientCode: 'LA', country: 'South Africa', month: 'OCT', number: 7 })).toBe('LA-ZAF-OCT-0007');
    expect(buildTripReference({ clientCode: 'MCF', country: 'Kenya', month: 'OCT', number: 2661 })).toBe('MCF-KEN-OCT-2661');
  });

  it('need a country from the master and a plain client code', () => {
    const trip = { customerId: 1, travelers: [{ name: 'Guest' }], title: 'Visit', items: [] };
    expect(tripCreateSchema.safeParse(trip).error?.issues[0]?.message).toBe('Pick the country');
    expect(tripCreateSchema.safeParse({ ...trip, country: 'Somalia' }).success).toBe(false);
    expect(tripCreateSchema.safeParse({ ...trip, country: 'Kenya', clientCode: 'MC F' }).success).toBe(false);
    expect(tripCreateSchema.safeParse({ ...trip, country: 'Kenya', clientCode: 'MCF' }).success).toBe(true);
  });
});

describe('GET /api/trips/form-options', () => {
  it("gives each client their reference code and usual country, and the next number", async () => {
    requireModuleRequest.mockResolvedValue({ auth: { user: { id: 7 } }, response: null });
    listCustomers.mockResolvedValue([
      { id: 1, name: 'Mastercard Foundation', company: null, email: null },
      { id: 2, name: 'Jane Doe', company: 'Harbour Partners', email: null },
    ]);
    listReferenceDefaults.mockResolvedValue(new Map([[1, { clientCode: 'MCF', country: 'Kenya' }]]));
    peekNextReferenceNumber.mockResolvedValue(2661);

    const body = await (await formOptions(new NextRequest('http://localhost/api/trips/form-options'))).json();

    expect(body.nextReferenceNumber).toBe(2661);
    expect(body.customers).toEqual([
      { id: 1, name: 'Mastercard Foundation', company: null, email: null, referenceCode: 'MCF', usualCountry: 'Kenya' },
      { id: 2, name: 'Jane Doe', company: 'Harbour Partners', email: null, referenceCode: 'HP', usualCountry: null },
    ]);
  });
});
