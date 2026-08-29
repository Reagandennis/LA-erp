import { describe, expect, it } from 'vitest';

import { filterDevices, matchesDevice, searchTokens } from '../app/modules/map/device-search';
import type { MapCategoryDto, TrackedDevice } from '../lib/map-types';

const categories: Record<number, MapCategoryDto> = {
  1: { id: 1, name: 'Patrol vehicles', color: '#03458f', icon: 'vehicle', scope: 'device', sortOrder: 0 },
  2: { id: 2, name: 'Escort teams', color: '#9333ea', icon: 'shield', scope: 'device', sortOrder: 1 },
};

function device(over: Partial<TrackedDevice> = {}): TrackedDevice {
  return {
    key: 'traccar:1',
    source: 'traccar',
    name: 'ETH 01',
    uniqueId: '860123456789012',
    lat: 9,
    lon: 38.8,
    at: Date.now(),
    ...over,
  };
}

describe('searchTokens', () => {
  it('splits on whitespace and lowercases', () => {
    expect(searchTokens('  ETH   01 ')).toEqual(['eth', '01']);
  });

  it('is empty for a blank query', () => {
    expect(searchTokens('   ')).toEqual([]);
  });
});

describe('matchesDevice', () => {
  const d = device();

  it('matches every token, not just one', () => {
    // "eth 01" must not also return ETH 02 — this is the whole point of AND matching.
    expect(matchesDevice(d, searchTokens('eth 01'), categories, null)).toBe(true);
    expect(matchesDevice(device({ name: 'ETH 02' }), searchTokens('eth 01'), categories, null)).toBe(false);
  });

  it('ignores token order', () => {
    expect(matchesDevice(d, searchTokens('01 eth'), categories, null)).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(matchesDevice(d, searchTokens('eth'), categories, null)).toBe(true);
    expect(matchesDevice(d, searchTokens('ETH'), categories, null)).toBe(true);
  });

  it('finds a tracker by its IMEI', () => {
    expect(matchesDevice(d, searchTokens('8601234'), categories, null)).toBe(true);
  });

  it('does not let a short token trawl the IMEI', () => {
    // "01" appears inside almost every IMEI; searching "eth 01" must not return
    // ETH 02 just because its unique id happens to contain those digits.
    expect(matchesDevice(device({ name: 'ETH 02' }), searchTokens('01'), categories, null)).toBe(false);
    expect(matchesDevice(device({ name: 'ETH 02' }), searchTokens('8901'), categories, null)).toBe(true);
  });

  it('finds devices by category name', () => {
    expect(matchesDevice(d, searchTokens('patrol'), categories, 1)).toBe(true);
    expect(matchesDevice(d, searchTokens('patrol'), categories, 2)).toBe(false);
    expect(matchesDevice(d, searchTokens('patrol'), categories, null)).toBe(false);
  });

  it('finds devices by source', () => {
    expect(matchesDevice(d, searchTokens('traccar'), categories, null)).toBe(true);
    expect(matchesDevice(device({ source: 'zello' }), searchTokens('traccar'), categories, null)).toBe(false);
  });

  it('matches everything when the query is empty', () => {
    expect(matchesDevice(d, [], categories, null)).toBe(true);
  });

  it('tolerates a device with no uniqueId', () => {
    expect(matchesDevice(device({ uniqueId: undefined }), searchTokens('eth'), categories, null)).toBe(true);
  });
});

describe('filterDevices', () => {
  const devices = [
    device({ key: 'a', name: 'ETH 01' }),
    device({ key: 'b', name: 'ETH 02' }),
    device({ key: 'c', name: 'Ghana 01', uniqueId: '999' }),
  ];

  it('returns the original list untouched for a blank query', () => {
    expect(filterDevices(devices, '  ', categories, () => null)).toBe(devices);
  });

  it('narrows to the matching devices', () => {
    expect(filterDevices(devices, 'eth', categories, () => null).map((d) => d.name)).toEqual([
      'ETH 01',
      'ETH 02',
    ]);
    expect(filterDevices(devices, 'ghana', categories, () => null).map((d) => d.name)).toEqual(['Ghana 01']);
  });

  it('returns nothing when nothing matches', () => {
    expect(filterDevices(devices, 'zzz', categories, () => null)).toEqual([]);
  });

  it('uses each device\'s own category', () => {
    const byKey = (d: TrackedDevice) => (d.key === 'a' ? 1 : 2);
    expect(filterDevices(devices, 'escort', categories, byKey).map((d) => d.key)).toEqual(['b', 'c']);
  });
});
