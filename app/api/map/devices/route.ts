import { NextRequest, NextResponse } from 'next/server';

import type { TrackedDevice } from '@/lib/map-types';
import { fetchTraccarSnapshot } from '@/lib/traccar-server';
import { requireModuleRequest } from '@/lib/request-auth';
import { getZelloLocations } from '@/lib/zello-work';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export interface SourceStatus {
  configured: boolean;
  count: number;
  error: string | null;
}

/**
 * Every live position the map should show, from every configured source.
 *
 * One endpoint rather than one per source: the map needs a single merged list,
 * and a source being down should never blank out the others.
 */
export async function GET(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, 'map');
  if (response || !auth) return response;

  const [traccar, zello] = await Promise.all([fetchTraccarSnapshot(), loadZello()]);

  const devices: TrackedDevice[] = [...(traccar?.devices ?? []), ...zello.devices].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  return NextResponse.json({
    devices,
    sources: {
      traccar: {
        configured: traccar !== null,
        count: traccar?.devices.length ?? 0,
        error: traccar?.error ?? null,
      } satisfies SourceStatus,
      zello: zello.status,
    },
    at: new Date().toISOString(),
  });
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

    return {
      devices,
      status: { configured: true, count: devices.length, error: result.error },
    };
  } catch (error) {
    return {
      devices: [],
      status: {
        configured: true,
        count: 0,
        error: error instanceof Error ? error.message : 'Could not reach Zello.',
      },
    };
  }
}
