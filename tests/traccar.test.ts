import { describe, expect, it } from 'vitest';

import { toTrackedDevice, toTrackedDevices, traccarKey } from '../lib/traccar';
import type { TraccarDevice, TraccarPosition } from '../lib/traccar';

const device: TraccarDevice = {
  id: 7,
  name: 'Land Cruiser KDA 001A',
  uniqueId: '860123456789012',
  status: 'online',
  category: 'car',
};

const position: TraccarPosition = {
  deviceId: 7,
  latitude: -1.2921,
  longitude: 36.8219,
  speed: 27, // knots
  course: 91.6,
  accuracy: 12,
  address: 'Mombasa Road, Nairobi',
  fixTime: '2026-08-28T06:00:00Z',
  serverTime: '2026-08-28T06:00:09Z',
  attributes: { batteryLevel: 87, ignition: true },
};

describe('traccarKey', () => {
  it('namespaces the id so Traccar and Zello devices cannot collide', () => {
    expect(traccarKey(7)).toBe('traccar:7');
  });
});

describe('toTrackedDevice', () => {
  const mapped = toTrackedDevice(device, position);

  it('maps a device and its position onto the map shape', () => {
    expect(mapped).toMatchObject({
      key: 'traccar:7',
      source: 'traccar',
      name: 'Land Cruiser KDA 001A',
      lat: -1.2921,
      lon: 36.8219,
      accuracy: 12,
      address: 'Mombasa Road, Nairobi',
      course: 92,
      batteryPct: 87,
      online: true,
      category: 'car',
    });
  });

  it('converts speed from knots to km/h', () => {
    // Traccar stores speed in knots; showing it as km/h without converting
    // under-reports by ~46%, which is the kind of bug nobody notices.
    expect(mapped?.speedKph).toBeCloseTo(50, 0);
  });

  it('prefers the fix time over the server time', () => {
    expect(mapped?.at).toBe(Date.parse('2026-08-28T06:00:00Z'));
  });

  it('ignores a fix time that is decades adrift from the server clock', () => {
    // A GPS week-number rollover dates fixes ~19.6 years in the past. Trusting it
    // would show a live tracker as two decades stale.
    const rolled = toTrackedDevice(device, {
      ...position,
      fixTime: '2006-11-22T03:22:27Z',
      deviceTime: '2006-11-22T03:22:27Z',
      serverTime: '2026-07-08T06:22:28Z',
    });
    expect(rolled?.at).toBe(Date.parse('2026-07-08T06:22:28Z'));
  });

  it('keeps a genuinely old fix from a tracker that was out of coverage', () => {
    // Store-and-forward: the fix really is three weeks old and must not be rewritten.
    const buffered = toTrackedDevice(device, {
      ...position,
      fixTime: '2026-08-01T00:00:00Z',
      serverTime: '2026-08-22T00:00:00Z',
    });
    expect(buffered?.at).toBe(Date.parse('2026-08-01T00:00:00Z'));
  });

  it('falls back through deviceTime then serverTime', () => {
    const noFix = toTrackedDevice(device, {
      ...position,
      fixTime: undefined,
      deviceTime: '2026-08-28T05:00:00Z',
    });
    expect(noFix?.at).toBe(Date.parse('2026-08-28T05:00:00Z'));
  });

  it('names an unnamed device after its uniqueId, then its id', () => {
    expect(toTrackedDevice({ id: 7, uniqueId: 'IMEI-1' }, position)?.name).toBe('IMEI-1');
    expect(toTrackedDevice({ id: 7 }, position)?.name).toBe('Device 7');
    expect(toTrackedDevice(undefined, position)?.name).toBe('Device 7');
  });

  it('drops a device parked on null island', () => {
    // Traccar keeps rows for trackers that never got a fix; they report 0,0.
    expect(toTrackedDevice(device, { ...position, latitude: 0, longitude: 0 })).toBeNull();
  });

  it('drops non-numeric coordinates', () => {
    expect(
      toTrackedDevice(device, { ...position, latitude: Number.NaN }),
    ).toBeNull();
  });

  it('hides a disabled device', () => {
    expect(toTrackedDevice({ ...device, disabled: true }, position)).toBeNull();
  });

  it('omits accuracy when Traccar reports none', () => {
    expect(toTrackedDevice(device, { ...position, accuracy: 0 })?.accuracy).toBeUndefined();
  });

  it('reports offline status', () => {
    expect(toTrackedDevice({ ...device, status: 'offline' }, position)?.online).toBe(false);
    expect(toTrackedDevice({ id: 7 }, position)?.online).toBeUndefined();
  });
});

describe('toTrackedDevices', () => {
  it('joins the two endpoints and sorts by name', () => {
    const devices: TraccarDevice[] = [
      { id: 7, name: 'Zulu' },
      { id: 8, name: 'Alpha' },
    ];
    const positions: TraccarPosition[] = [
      { ...position, deviceId: 7 },
      { ...position, deviceId: 8, latitude: -1.3, longitude: 36.9 },
    ];
    expect(toTrackedDevices(devices, positions).map((d) => d.name)).toEqual(['Alpha', 'Zulu']);
  });

  it('keeps only the newest position per device', () => {
    const positions: TraccarPosition[] = [
      { ...position, fixTime: '2026-08-28T06:00:00Z' },
      { ...position, fixTime: '2026-08-28T07:00:00Z', latitude: -1.4 },
    ];
    const [only] = toTrackedDevices([device], positions);
    expect(toTrackedDevices([device], positions)).toHaveLength(1);
    expect(only.lat).toBe(-1.4);
  });

  it('maps a position whose device is missing from the device list', () => {
    expect(toTrackedDevices([], [position])).toHaveLength(1);
  });

  it('returns nothing for empty input', () => {
    expect(toTrackedDevices([], [])).toEqual([]);
  });
});
