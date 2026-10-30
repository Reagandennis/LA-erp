import 'server-only';

import type { TrackedDevice } from './map-types';
import { fetchTraccarSnapshot } from './traccar-server';
import { getZelloLocations } from './zello-work';

/**
 * Every live position from every configured tracking source, merged into one
 * list. The Map module and the Ops Dashboard both read it: one list rather
 * than one per source, and a source being down never blanks out the others.
 */

export interface SourceStatus {
  configured: boolean;
  count: number;
  error: string | null;
}

export interface TrackedDevices {
  devices: TrackedDevice[];
  sources: Record<'traccar' | 'zello', SourceStatus>;
}

export async function listTrackedDevices(): Promise<TrackedDevices> {
  const [traccar, zello] = await Promise.all([fetchTraccarSnapshot(), loadZello()]);
  const devices = [...(traccar?.devices ?? []), ...zello.devices].sort((a, b) => a.name.localeCompare(b.name));
  return {
    devices,
    sources: {
      traccar: { configured: traccar !== null, count: traccar?.devices.length ?? 0, error: traccar?.error ?? null },
      zello: zello.status,
    },
  };
}

async function loadZello(): Promise<{ devices: TrackedDevice[]; status: SourceStatus }> {
  try {
    const result = await getZelloLocations();
    if (!result.configured) {
      return { devices: [], status: { configured: false, count: 0, error: null } };
    }
    const devices: TrackedDevice[] = result.devices
      .map((it) => ({
        key: `zello:${it.device}`,
        source: 'zello' as const,
        name: it.displayName || it.device,
        lat: Number(it.latitude),
        lon: Number(it.longitude),
        at: new Date(it.at).getTime(),
        accuracy: it.accuracy ?? undefined,
        course: it.heading ?? undefined,
        batteryPct: it.batteryLevel ?? undefined,
        // Zello does not document a unit for `speed`, so it is left out rather
        // than shown next to Traccar's converted km/h and quietly compared.
      }))
      .filter((d) => Number.isFinite(d.lat) && Number.isFinite(d.lon) && Number.isFinite(d.at));

    return { devices, status: { configured: true, count: devices.length, error: result.error } };
  } catch (error) {
    return {
      devices: [],
      status: { configured: true, count: 0, error: error instanceof Error ? error.message : 'Could not reach Zello.' },
    };
  }
}
