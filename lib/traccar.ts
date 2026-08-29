/**
 * Traccar integration — REST reads plus the pure mapping into `TrackedDevice`.
 *
 * Verified against the Traccar 6.6 OpenAPI spec:
 *   - `GET /api/devices`    → id, name, uniqueId, status, category, lastUpdate, disabled
 *   - `GET /api/positions`  → with no parameters, "a list of last known positions
 *                             for all the user's Devices"
 *   - Auth: `Authorization: Bearer <token>` (the spec's `ApiKey` scheme), or a
 *     session created with `GET /api/session?token=<token>`.
 *
 * The mapping functions here are pure so they can be tested without a server.
 */

import type { DeviceSource, TrackedDevice } from './map-types';

export const TRACCAR_SOURCE: DeviceSource = 'traccar';

/** Traccar reports speed in knots. */
const KNOTS_TO_KPH = 1.852;

export interface TraccarDevice {
  id: number;
  name?: string;
  uniqueId?: string;
  status?: string;
  category?: string;
  lastUpdate?: string;
  disabled?: boolean;
}

export interface TraccarPosition {
  id?: number;
  deviceId: number;
  latitude: number;
  longitude: number;
  altitude?: number;
  speed?: number;
  course?: number;
  accuracy?: number;
  address?: string | null;
  valid?: boolean;
  outdated?: boolean;
  fixTime?: string;
  deviceTime?: string;
  serverTime?: string;
  attributes?: Record<string, unknown>;
}

export interface TraccarConfig {
  url: string;
  token: string;
}

/** Reads config without throwing, so callers can degrade to "not configured". */
export function traccarConfig(): TraccarConfig | null {
  const url = process.env.TRACCAR_URL?.trim().replace(/\/+$/, '');
  const token = process.env.TRACCAR_TOKEN?.trim();
  return url && token ? { url, token } : null;
}

/** The device key used across the map, the roster and MapDeviceTag. */
export function traccarKey(deviceId: number): string {
  return `traccar:${deviceId}`;
}

function batteryOf(attributes: Record<string, unknown> | undefined): number | undefined {
  const raw = attributes?.batteryLevel ?? attributes?.battery;
  const value = typeof raw === 'number' ? raw : Number.NaN;
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : undefined;
}

/**
 * A GPS week-number rollover makes a tracker report a fix ~19.6 years in the
 * past. One unit in this fleet dates its fixes to 2006 while the server received
 * them in 2026. Anything that far adrift from the server's own clock is a device
 * bug, not a real age.
 *
 * The threshold is deliberately generous: a tracker that buffers positions while
 * out of coverage and uploads them days or weeks later is reporting a genuinely
 * old fix, and that must not be rewritten.
 */
const CLOCK_SANITY_MS = 2 * 365 * 24 * 60 * 60 * 1000;

function parseTime(value: string | undefined): number | null {
  if (!value) return null;
  const at = new Date(value).getTime();
  return Number.isFinite(at) ? at : null;
}

/**
 * When the fix was taken, so a device reconnecting after a gap is not shown as
 * if it had just reported — unless its clock is obviously wrong, in which case
 * when the server heard from it is the more useful answer.
 */
function fixTimeOf(position: TraccarPosition): number {
  const server = parseTime(position.serverTime);
  const reported = parseTime(position.fixTime) ?? parseTime(position.deviceTime);

  if (reported === null) return server ?? Date.now();
  if (server !== null && Math.abs(server - reported) > CLOCK_SANITY_MS) return server;
  return reported;
}

/** Join one device with its latest position. Returns null when unmappable. */
export function toTrackedDevice(
  device: TraccarDevice | undefined,
  position: TraccarPosition,
): TrackedDevice | null {
  const lat = Number(position.latitude);
  const lon = Number(position.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  // Traccar keeps rows for devices that never got a valid fix; 0,0 is its null island.
  if (lat === 0 && lon === 0) return null;
  if (device?.disabled) return null;

  const speed = Number(position.speed);
  const course = Number(position.course);

  return {
    key: traccarKey(position.deviceId),
    source: TRACCAR_SOURCE,
    name: device?.name?.trim() || device?.uniqueId || `Device ${position.deviceId}`,
    uniqueId: device?.uniqueId || undefined,
    lat,
    lon,
    at: fixTimeOf(position),
    accuracy: Number.isFinite(Number(position.accuracy)) && Number(position.accuracy) > 0
      ? Number(position.accuracy)
      : undefined,
    address: position.address?.trim() || undefined,
    speedKph: Number.isFinite(speed) ? Math.round(speed * KNOTS_TO_KPH * 10) / 10 : undefined,
    course: Number.isFinite(course) ? Math.round(course) : undefined,
    batteryPct: batteryOf(position.attributes),
    online: device?.status ? device.status === 'online' : undefined,
    category: device?.category ?? undefined,
  };
}

/** Join a device list and a position list into the map's device shape. */
export function toTrackedDevices(
  devices: TraccarDevice[],
  positions: TraccarPosition[],
): TrackedDevice[] {
  const byId = new Map(devices.map((d) => [d.id, d]));
  const out: TrackedDevice[] = [];
  // Newer positions win when Traccar sends more than one row per device.
  const latest = new Map<number, TraccarPosition>();
  for (const position of positions) {
    const existing = latest.get(position.deviceId);
    if (!existing || fixTimeOf(position) >= fixTimeOf(existing)) latest.set(position.deviceId, position);
  }
  for (const position of latest.values()) {
    const mapped = toTrackedDevice(byId.get(position.deviceId), position);
    if (mapped) out.push(mapped);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
