/**
 * Types shared by the map's server store, its API routes and its client panels.
 *
 * Kept free of `server-only` and of Prisma imports so the browser bundle can use
 * the same shapes the routes serialize.
 */

import type { GeoGeometry, GeofenceGeometry, LatLngBounds } from './geo-geometry';

export type StrokeDash = 'solid' | 'dashed' | 'dotted';

/** Stored in the `style` Json column on layers, features and geofences. */
export interface MapStyle {
  stroke: string;
  strokeWidth: number;
  strokeDash: StrokeDash;
  fill: string;
  fillOpacity: number;
}

export const DEFAULT_STYLE: MapStyle = {
  stroke: '#03458f',
  strokeWidth: 2,
  strokeDash: 'solid',
  fill: '#03458f',
  fillOpacity: 0.15,
};

/** Boundary overlays are thin outlines with no fill — they sit under everything else. */
export const BOUNDARY_STYLE: MapStyle = {
  stroke: '#6b7280',
  strokeWidth: 1,
  strokeDash: 'solid',
  fill: '#6b7280',
  fillOpacity: 0,
};

/** Where a live position came from. Both sources render on the same map. */
export type DeviceSource = 'zello' | 'traccar';

/**
 * A live device position, normalised across sources. `key` is what the map,
 * the roster and MapDeviceTag all index on, so it has to be stable and unique
 * across sources — hence the `source:id` form.
 */
export interface TrackedDevice {
  key: string;
  source: DeviceSource;
  name: string;
  /** Traccar's uniqueId (usually the IMEI). Searchable, never displayed as the name. */
  uniqueId?: string;
  lat: number;
  lon: number;
  /** Epoch ms of the position fix. */
  at: number;
  accuracy?: number;
  address?: string;
  speedKph?: number;
  /** Heading in degrees, 0 = north. */
  course?: number;
  batteryPct?: number;
  /** Traccar reports online/offline explicitly; Zello does not. */
  online?: boolean;
  category?: string;
}

export type CategoryScope = 'feature' | 'device' | 'both';
export type LayerKind = 'drawn' | 'import' | 'boundary';
export type ImportSource = 'kmz' | 'kml' | 'csv';
export type GeofenceShape = 'polygon' | 'circle' | 'rectangle';

export interface MapCategoryDto {
  id: number;
  name: string;
  color: string;
  icon: string;
  scope: CategoryScope;
  sortOrder: number;
}

export interface MapLayerDto {
  id: number;
  name: string;
  kind: LayerKind;
  source: ImportSource | null;
  fileName: string | null;
  fileSize: number | null;
  visible: boolean;
  sortOrder: number;
  categoryId: number | null;
  style: MapStyle;
  featureCount: number;
  /** Frame for "zoom to layer", computed at import time. Null for empty layers. */
  bounds: LatLngBounds | null;
  createdAt: string;
}

export interface MapFeatureDto {
  id: number;
  layerId: number;
  categoryId: number | null;
  name: string;
  description: string | null;
  geometryType: string;
  geometry: GeoGeometry;
  properties: Record<string, string> | null;
  style: Partial<MapStyle> | null;
  icon: string | null;
}

export interface MapGeofenceDto {
  id: number;
  name: string;
  shape: GeofenceShape;
  geometry: GeofenceGeometry;
  style: MapStyle;
  visible: boolean;
  categoryId: number | null;
}

export interface MapDeviceTagDto {
  device: string;
  categoryId: number | null;
  icon: string | null;
  label: string | null;
}

export interface MapWorkspaceDto {
  categories: MapCategoryDto[];
  layers: MapLayerDto[];
  geofences: MapGeofenceDto[];
  deviceTags: MapDeviceTagDto[];
}

/** What the KML and CSV readers produce, before it is written to the database. */
export interface ParsedFeature {
  name: string;
  description: string | null;
  geometry: GeoGeometry;
  properties: Record<string, string>;
  /** Category *name* from the source file; resolved to an id at import time. */
  category: string | null;
  style: Partial<MapStyle> | null;
}

/** Merge a partial override onto a base style. */
export function resolveStyle(base: MapStyle, override?: Partial<MapStyle> | null): MapStyle {
  return override ? { ...base, ...override } : base;
}

/** Dash patterns for Google Maps polyline/polygon rendering. */
export function dashArray(dash: StrokeDash, width: number): number[] | null {
  if (dash === 'dashed') return [Math.max(6, width * 3), Math.max(4, width * 2)];
  if (dash === 'dotted') return [1, Math.max(4, width * 2)];
  return null;
}
