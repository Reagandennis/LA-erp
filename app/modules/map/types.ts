import type { GeoGeometry, GeofenceGeometry } from '@/lib/geo-geometry';

export type { Basemap } from './basemaps';
export { BASEMAPS } from './basemaps';

/** Which tile overlays are switched on. Keys match OVERLAY_SOURCES. */
export interface OverlayToggles {
  cycling: boolean;
  transit: boolean;
}

/** `place` drops a single point on the next map click; the rest use DrawingManager. */
export type DrawMode = 'place' | 'polyline' | 'polygon' | 'rectangle' | 'circle';

export type DrawTarget = 'feature' | 'geofence';

export interface DrawnShape {
  target: DrawTarget;
  geometry: GeoGeometry | GeofenceGeometry;
  shape: 'polygon' | 'circle' | 'rectangle';
}

export type Selection =
  | { kind: 'device'; id: string }
  | { kind: 'feature'; id: number }
  | { kind: 'geofence'; id: number };

export interface MapFocus {
  kind: Selection['kind'];
  id: string | number;
  /** Bump to re-trigger for the same target. */
  n: number;
}

export type PanelTab = 'devices' | 'layers' | 'geofences' | 'categories' | 'borders';
