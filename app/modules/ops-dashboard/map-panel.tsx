'use client';

import { useMemo, useState } from 'react';

import MapCanvas from '@/app/modules/map/map-canvas';
import type { Selection } from '@/app/modules/map/types';
import { useNow } from '@/app/ui/use-client';
import type { LatLngBounds } from '@/lib/geo-geometry';
import type { MapCategoryDto, MapDeviceTagDto, MapFeatureDto, MapLayerDto, TrackedDevice } from '@/lib/map-types';
import type { OpsMap } from '@/lib/ops-dashboard';

import { trackerTally } from './ops-model';
import { Empty, HeaderButton, Panel, type PanelFrame } from './ops-ui';

const NO_IDS: number[] = [];
const NO_LAYERS: MapLayerDto[] = [];
const NO_FEATURES: Record<number, MapFeatureDto[]> = {};
const NO_OCCUPANCY: Record<number, string[]> = {};
const NO_OVERLAYS = { cycling: false, transit: false };
const noop = () => {};

/** A lone tracker still gets a neighbourhood around it, not a map zoomed to the limit. */
const MIN_SPAN_DEG = 0.02;

/** The frame holding every tracker, or null with none to frame. */
export function trackerBounds(devices: ReadonlyArray<Pick<TrackedDevice, 'lat' | 'lon'>>): LatLngBounds | null {
  if (devices.length === 0) return null;
  let north = -90;
  let south = 90;
  let east = -180;
  let west = 180;
  for (const d of devices) {
    north = Math.max(north, d.lat);
    south = Math.min(south, d.lat);
    east = Math.max(east, d.lon);
    west = Math.min(west, d.lon);
  }
  if (north - south < MIN_SPAN_DEG) {
    north += MIN_SPAN_DEG / 2;
    south -= MIN_SPAN_DEG / 2;
  }
  if (east - west < MIN_SPAN_DEG) {
    east += MIN_SPAN_DEG / 2;
    west -= MIN_SPAN_DEG / 2;
  }
  return { north, south, east, west };
}

/**
 * The Map module's live map on the board: every tracker as a pin, the zones
 * around them, framed on the fleet. The corner opens the module for layers,
 * drawing and history.
 */
export default function MapPanel({ data, frame }: Readonly<{ data: OpsMap; frame: PanelFrame }>) {
  const now = useNow(30_000);
  const [selection, setSelection] = useState<Selection | null>(null);
  // Framed on the trackers at first paint and on "Fit all"; a poll never moves the map under the viewer.
  const [fit, setFit] = useState(() => {
    const bounds = trackerBounds(data.devices);
    return bounds ? { bounds, n: 1 } : null;
  });
  const refit = () => {
    const bounds = trackerBounds(data.devices);
    if (bounds) setFit((was) => ({ bounds, n: (was?.n ?? 0) + 1 }));
  };

  const deviceTags = useMemo(
    () => Object.fromEntries(data.deviceTags.map((tag) => [tag.device, tag])) as Record<string, MapDeviceTagDto>,
    [data.deviceTags],
  );
  const categories = useMemo(
    () => Object.fromEntries(data.categories.map((category) => [category.id, category])) as Record<number, MapCategoryDto>,
    [data.categories],
  );

  const tally = now === null ? null : trackerTally(data.devices, now);
  const summary = !data.configured ? 'No tracking source' : tally ? `${tally.online} of ${tally.total} online` : `${data.devices.length} trackers`;

  return (
    <Panel
      id="ops-map"
      title="Live map"
      summary={summary}
      href="/modules/map"
      moduleName="Map"
      frame={frame}
      defaultCols={3}
      actions={data.devices.length > 0 && <HeaderButton onClick={refit}>Fit all</HeaderButton>}
    >
      {!data.configured ? (
        <Empty>No tracking source is configured. Set TRACCAR_URL and TRACCAR_TOKEN, or the ZELLO_* variables, to see trackers here.</Empty>
      ) : (
        // `isolate` keeps Leaflet's own z-indexes inside the card, under the board's menus.
        <div className="relative isolate z-0 mt-3 h-[26rem] overflow-hidden rounded-xl border border-gray-200 [[data-sized]_&]:h-[calc(100%-0.75rem)]">
          <MapCanvas
            devices={data.devices}
            deviceTags={deviceTags}
            categories={categories}
            hiddenCategoryIds={NO_IDS}
            layers={NO_LAYERS}
            featuresByLayer={NO_FEATURES}
            geofences={data.geofences}
            occupancy={NO_OCCUPANCY}
            basemap="streets"
            overlays={NO_OVERLAYS}
            drawMode={null}
            drawTarget="feature"
            selection={selection}
            focus={null}
            fitBounds={fit}
            onDrawComplete={noop}
            onSelect={setSelection}
            onGeometryEdit={noop}
          />
          {data.error && (
            <p
              className="absolute bottom-2 left-2 z-[1000] max-w-[80%] truncate rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs text-amber-800 shadow-sm"
              title={data.error}
            >
              {data.error}
            </p>
          )}
          {data.devices.length === 0 && !data.error && (
            <p className="absolute left-1/2 top-2 z-[1000] -translate-x-1/2 rounded-lg bg-white/90 px-2.5 py-1 text-xs text-gray-500 shadow-sm">
              No tracker has reported a position yet.
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}
