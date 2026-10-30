import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { airlineCodeOf, findAirline } from '../lib/airlines';
import { findAirport, searchAirports } from '../lib/airports';

describe('the airport table', () => {
  it('knows an airport by either code, with its time zone', () => {
    expect(findAirport('HKJK', null)).toMatchObject({ iata: 'NBO', city: 'Nairobi', tz: 'Africa/Nairobi' });
    expect(findAirport(null, 'lhr')).toMatchObject({ icao: 'EGLL', tz: 'Europe/London' });
    expect(findAirport('XXXX', 'XXX')).toBeNull();
  });

  it('autocompletes codes, cities and names, exact code first', () => {
    expect(searchAirports('nbo')[0]?.iata).toBe('NBO');
    expect(searchAirports('hkjk')[0]?.iata).toBe('NBO');
    expect(searchAirports('nair').map((a) => a.iata)).toContain('NBO');
    expect(searchAirports('jomo kenyatta')[0]?.iata).toBe('NBO');
    expect(searchAirports('lon', 3)).toHaveLength(3);
    expect(searchAirports('')).toEqual([]);
  });
});

describe('the airline table', () => {
  it('names a carrier by ICAO or IATA code', () => {
    expect(findAirline('KQA', null)?.name).toBe('Kenya Airways');
    expect(findAirline(null, 'EK')?.name).toBe('Emirates');
    expect(findAirline('ZZZZ', 'ZZZZ')).toBeNull();
  });

  it('reads the carrier code off a flight number', () => {
    expect(airlineCodeOf('KQ100')).toBe('KQ');
    expect(airlineCodeOf('6E123')).toBe('6E');
    expect(airlineCodeOf('U2456')).toBe('U2');
    expect(airlineCodeOf('100')).toBeNull();
  });
});
