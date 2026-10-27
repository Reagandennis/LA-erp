import { describe, expect, it } from 'vitest';

import { servicePatch } from '../app/modules/trip-planning/[tripId]/_components/service-picker';
import type { EditorState } from '../app/modules/trip-planning/[tripId]/editor-state';
import { pruneDetails } from '../app/modules/trip-planning/[tripId]/categories';
import {
  SERVICE_CATEGORIES,
  SERVICE_COUNTRIES,
  SERVICE_TIERS,
  UNITS_OF_MEASURE,
  isAirportPlace,
  serviceMatches,
  transportTypeForRoute,
  transportTypeForService,
  type ServiceOption,
} from '../lib/service-catalog';
import { productCreateSchema, productUpdateSchema, tripItemDetailsSchema } from '../lib/validation';
import { PROPOSED_NOTE, loadStandardCatalog, standardServicesToCreate } from '../prisma/seed-services';

const catalog = loadStandardCatalog();

describe('the Standardized Naming Master data', () => {
  it('holds the 735 services, each with a unique code', () => {
    expect(catalog.services).toHaveLength(735);
    expect(new Set(catalog.services.map((s) => s.code)).size).toBe(735);
  });

  it('only uses the vocabulary the app offers', () => {
    const unknown = (values: Array<string | undefined>, known: readonly string[]) =>
      [...new Set(values.filter((v): v is string => Boolean(v) && !known.includes(v!)))];
    expect(unknown(catalog.services.map((s) => s.category), SERVICE_CATEGORIES)).toEqual([]);
    expect(unknown(catalog.services.map((s) => s.country), SERVICE_COUNTRIES)).toEqual([]);
    expect(unknown(catalog.services.map((s) => s.tier), SERVICE_TIERS)).toEqual([]);
    expect(unknown(catalog.services.map((s) => s.unitOfMeasure), UNITS_OF_MEASURE)).toEqual([]);
  });

  it('fits the product columns', () => {
    for (const service of catalog.services) {
      const parsed = productCreateSchema.safeParse({ ...service, sku: service.code, defaultUnitPrice: 0 });
      expect(parsed.success, service.code).toBe(true);
    }
  });

  it('marks the rows still awaiting confirmation as proposed', () => {
    const proposed = catalog.services.filter((s) => s.proposed).map((s) => s.code);
    expect(proposed).toHaveLength(24);
    expect(proposed.filter((code) => code.startsWith('ZMB-'))).toHaveLength(20);
    expect(proposed).toContain('GHA-HIR-SUV-STA-FD-ACC');
  });
});

describe('standardServicesToCreate', () => {
  const defaults = { currency: 'USD', createdById: 1 };

  it('adds each service under its standardized name and code, unpriced', () => {
    const rows = standardServicesToCreate(catalog, new Set(), defaults);
    expect(rows).toHaveLength(735);
    expect(rows.find((r) => r.sku === 'KEN-TRF-SUV-EXE-NBO')).toMatchObject({
      name: 'Airport Transfer - SUV Executive - Nairobi (NBO)',
      quickbooksName: 'Transfers:Airport Transfer:SUV Executive:Nairobi (NBO)',
      category: 'Transfers',
      subCategory: 'Airport Transfer',
      serviceClass: 'SUV',
      tier: 'Executive',
      country: 'Kenya',
      airportCode: 'NBO',
      unitOfMeasure: 'Per one-way transfer',
      defaultUnitPrice: 0,
      archived: false,
    });
  });

  it('archives proposed services with a note saying why', () => {
    const zambia = standardServicesToCreate(catalog, new Set(), defaults).find((r) => r.sku === 'ZMB-ESC-POL');
    expect(zambia?.archived).toBe(true);
    expect(zambia?.notes?.startsWith(PROPOSED_NOTE)).toBe(true);
  });

  it('never adds a code the catalog already has', () => {
    const rows = standardServicesToCreate(catalog, new Set(['KEN-TRF-SUV-EXE-NBO', 'KEN-APT-ARR-NBO']), defaults);
    expect(rows).toHaveLength(733);
    expect(rows.some((r) => r.sku === 'KEN-TRF-SUV-EXE-NBO')).toBe(false);
  });
});

describe('product validation', () => {
  it('saves a blank master column as empty', () => {
    const parsed = productCreateSchema.parse({ name: 'Mi-Fi Device - Kenya', defaultUnitPrice: 0, tier: '  ', category: 'Add-Ons' });
    expect(parsed.tier).toBeNull();
    expect(parsed.category).toBe('Add-Ons');
    expect(parsed.currency).toBe('USD');
  });

  it('leaves out of an update what the request left out', () => {
    expect(productUpdateSchema.parse({ archived: true })).toEqual({ archived: true });
  });
});

describe('trip event services', () => {
  it('accepts a service on every kind of event but information', () => {
    const service = { service: 'Airport Arrival Assistance - Nairobi (NBO)', serviceCode: 'KEN-APT-ARR-NBO' };
    expect(tripItemDetailsSchema.safeParse({ ...service, flightNumber: 'KQ 101' }).success).toBe(true);
    expect(tripItemDetailsSchema.safeParse({ ...service, mode: 'Airport Transfer', pickupLocation: 'JKIA' }).success).toBe(true);
    expect(pruneDetails('transportation', { ...service, mode: 'Airport Transfer' })).toEqual({ ...service, mode: 'Airport Transfer' });
    expect(pruneDetails('information', service)).toBeNull();
  });

  const editor = (category: EditorState['category'], details: Record<string, string> = {}) =>
    ({ category, details }) as EditorState;
  const transfer: ServiceOption = {
    id: 1,
    code: 'KEN-TRF-P2P-SUV-STA-NBO',
    name: 'Point-to-Point Transfer - SUV Standard - Nairobi',
    category: 'Transfers',
    subCategory: 'Point-to-Point (P2P)',
    serviceClass: 'SUV',
    tier: 'Standard',
    country: 'Kenya',
    location: 'Nairobi',
    unitOfMeasure: 'Per one-way transfer',
  };

  it('copies the picked service, and a transport event takes its Type from it', () => {
    expect(servicePatch(editor('transportation', { mode: 'Airport Transfer', pickupLocation: 'Office' }), transfer)).toEqual({
      details: {
        mode: 'Point-to-Point Transfer',
        pickupLocation: 'Office',
        service: 'Point-to-Point Transfer - SUV Standard - Nairobi',
        serviceCode: 'KEN-TRF-P2P-SUV-STA-NBO',
      },
    });
    expect(servicePatch(editor('flight'), transfer).details).not.toHaveProperty('mode');
  });

  it('removes the service and leaves the rest', () => {
    const picked = editor('transportation', { service: 'X', serviceCode: 'Y', mode: 'Escort' });
    expect(servicePatch(picked, null)).toEqual({ details: { mode: 'Escort' } });
  });
});

describe('transportTypeForService', () => {
  it('names the movement the way the master does', () => {
    const type = (category: string, subCategory: string | null) => transportTypeForService({ category, subCategory });
    expect(type('Transfers', 'Airport Transfer')).toBe('Airport Transfer');
    expect(type('Transfers', 'Point-to-Point (P2P)')).toBe('Point-to-Point Transfer');
    expect(type('Vehicle Hire', 'Full Day')).toBe('Full Day Hire');
    expect(type('Vehicle Hire', 'Out of Town')).toBe('Out of Town Hire');
    expect(type('Excursion & Safari', 'Full Day')).toBe('Excursion & Safari');
    expect(type('Escort', 'Government Armed Escort')).toBe('Escort');
    expect(type('Personnel', 'Close Protection Officer')).toBeNull();
  });
});

describe('transportTypeForRoute', () => {
  it('reads an airport from the place name, not its address', () => {
    for (const place of [
      'JKIA',
      'JKIA (NBO), Embakasi, Nairobi, Kenya',
      'Bole International Airport, Addis Ababa, Ethiopia',
      'Uwanja wa ndege wa Kimataifa wa Jomo Kenyatta (NBO), Embakasi, Nairobi, Kenya',
      'Entebbe',
      'Entebbe Aiport',
      'Wilson Airport',
      'Kotoka International',
    ]) {
      expect(isAirportPlace(place), place).toBe(true);
    }
    for (const place of [
      'SKYLIGHT HOTEL GRAND BALLROOM (ABYSSINIA), Airport Road, Addis Ababa, Ethiopia',
      'Four Points by Sheraton Nairobi Airport',
      'Murtala Muhammed International Airport Hotel - Lagos (LOS), Ikeja, Nigeria',
      'Bole, Addis Ababa, Ethiopia',
      'Julius Nyerere International Convention Centre, Shaaban Robert Street, Dar es Salaam',
      '179 Runda Drive',
      null,
    ]) {
      expect(isAirportPlace(place), String(place)).toBe(false);
    }
  });

  it('calls a movement touching an airport an Airport Transfer', () => {
    expect(transportTypeForRoute(['Office', 'JKIA'])).toBe('Airport Transfer');
    expect(transportTypeForRoute(['179 Runda Drive', 'Village Market'])).toBe('Point-to-Point Transfer');
    expect(transportTypeForRoute([undefined, undefined])).toBe('Point-to-Point Transfer');
  });
});

describe('serviceMatches', () => {
  const service = { name: 'Close Protection Officer - Level 1', code: 'UGA-PER-CPO-L1', country: 'Uganda' } as ServiceOption;
  it('finds a service by name, code or country', () => {
    expect(serviceMatches(service, 'protection')).toBe(true);
    expect(serviceMatches(service, 'uga-per')).toBe(true);
    expect(serviceMatches(service, 'uganda')).toBe(true);
    expect(serviceMatches(service, 'kenya')).toBe(false);
  });
});
