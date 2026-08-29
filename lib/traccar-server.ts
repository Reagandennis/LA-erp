import 'server-only';

import { toTrackedDevices, traccarConfig, type TraccarDevice, type TraccarPosition } from './traccar';
import type { TrackedDevice } from './map-types';

/**
 * Server-side reads from Traccar.
 *
 * Polling rather than the WebSocket: Traccar's socket accepts only a session
 * cookie, and this deployment sits behind an nginx that strips the Upgrade
 * headers, so the handshake never completes. The REST endpoints work fine over
 * the same proxy. `lib/traccar.ts` holds the mapping either way, so moving to
 * the socket later only changes how updates arrive, not what they become.
 */

const REQUEST_TIMEOUT_MS = 10_000;

export interface TraccarSnapshot {
  devices: TrackedDevice[];
  /** Devices Traccar knows about but which have never reported a position. */
  silent: number;
  error: string | null;
}

async function get<T>(path: string, config: { url: string; token: string }): Promise<T> {
  const response = await fetch(`${config.url}${path}`, {
    headers: { Authorization: `Bearer ${config.token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(
      response.status === 401
        ? 'Traccar rejected the API token. It may have expired — tokens default to 7 days.'
        : `Traccar returned ${response.status} for ${path}.`,
    );
  }
  return (await response.json()) as T;
}

/** Latest position for every device, or null when Traccar is not configured. */
export async function fetchTraccarSnapshot(): Promise<TraccarSnapshot | null> {
  const config = traccarConfig();
  if (!config) return null;

  try {
    const [devices, positions] = await Promise.all([
      get<TraccarDevice[]>('/api/devices', config),
      get<TraccarPosition[]>('/api/positions', config),
    ]);
    const mapped = toTrackedDevices(devices, positions);
    return {
      devices: mapped,
      silent: Math.max(0, devices.filter((d) => !d.disabled).length - mapped.length),
      error: null,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.name === 'TimeoutError'
          ? 'Traccar did not respond in time.'
          : error.message
        : 'Could not reach Traccar.';
    return { devices: [], silent: 0, error: message };
  }
}
