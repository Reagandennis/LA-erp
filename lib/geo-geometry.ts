/**
 * Pure geometry helpers for the map module.
 *
 * Deliberately free of `server-only` and of any Google Maps dependency: the
 * browser imports these to decide which devices sit inside a geofence, and the
 * vitest suite imports the same functions under the `node` environment.
 *
 * Coordinates follow GeoJSON order — [longitude, latitude] — everywhere except
 * the `LatLng` point type, which matches what the Maps API hands us.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/** GeoJSON [lng, lat] pair. */
export type Position = [number, number];
export type Ring = Position[];

export type GeoGeometry =
  | { type: 'Point'; coordinates: Position }
  | { type: 'MultiPoint'; coordinates: Position[] }
  | { type: 'LineString'; coordinates: Position[] }
  | { type: 'MultiLineString'; coordinates: Position[][] }
  | { type: 'Polygon'; coordinates: Ring[] }
  | { type: 'MultiPolygon'; coordinates: Ring[][] };

/**
 * A saved geofence. Circles are not GeoJSON — there is no such primitive — so we
 * store the Maps-native centre/radius pair and tag it explicitly.
 */
export type GeofenceGeometry =
  | { type: 'Polygon'; coordinates: Ring[] }
  | { type: 'Circle'; center: Position; radius: number };

export interface LatLngBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

const EARTH_RADIUS_M = 6_371_008.8;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance in metres. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Ray casting against a single ring. A point exactly on an edge counts as inside
 * so a device parked on a fence boundary is not reported as having left it.
 *
 * Planar, so it is wrong for rings that straddle the antimeridian. Geofences are
 * drawn by hand over an operating area, so that case does not arise in practice.
 */
export function pointInRing(point: LatLng, ring: Ring): boolean {
  if (ring.length < 3) return false;
  const { lat: y, lng: x } = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (isOnSegment(x, y, xi, yi, xj, yj)) return true;
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function isOnSegment(
  x: number,
  y: number,
  xi: number,
  yi: number,
  xj: number,
  yj: number,
): boolean {
  const cross = (xj - xi) * (y - yi) - (yj - yi) * (x - xi);
  if (Math.abs(cross) > 1e-12) return false;
  return (
    Math.min(xi, xj) - 1e-12 <= x &&
    x <= Math.max(xi, xj) + 1e-12 &&
    Math.min(yi, yj) - 1e-12 <= y &&
    y <= Math.max(yi, yj) + 1e-12
  );
}

/** Inside the outer ring and outside every hole. */
export function pointInPolygon(point: LatLng, coordinates: Ring[]): boolean {
  if (coordinates.length === 0) return false;
  if (!pointInRing(point, coordinates[0])) return false;
  for (let i = 1; i < coordinates.length; i += 1) {
    if (pointInRing(point, coordinates[i])) return false;
  }
  return true;
}

export function isInsideGeofence(geometry: GeofenceGeometry, point: LatLng): boolean {
  if (geometry.type === 'Circle') {
    const [lng, lat] = geometry.center;
    return haversineMeters({ lat, lng }, point) <= geometry.radius;
  }
  return pointInPolygon(point, geometry.coordinates);
}

function walkPositions(coords: unknown, visit: (p: Position) => void): void {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
    visit(coords as Position);
    return;
  }
  for (const child of coords) walkPositions(child, visit);
}

/** Bounding box over any mix of geometries, or null when there is nothing to frame. */
export function boundsOf(geometries: Array<GeoGeometry | GeofenceGeometry>): LatLngBounds | null {
  let north = -Infinity;
  let south = Infinity;
  let east = -Infinity;
  let west = Infinity;
  let seen = false;

  const extend = (lng: number, lat: number) => {
    seen = true;
    if (lat > north) north = lat;
    if (lat < south) south = lat;
    if (lng > east) east = lng;
    if (lng < west) west = lng;
  };

  for (const geometry of geometries) {
    if (!geometry) continue;
    if (geometry.type === 'Circle') {
      // Approximate the circle by its bounding square — good enough to frame it.
      const [lng, lat] = geometry.center;
      const dLat = (geometry.radius / EARTH_RADIUS_M) * (180 / Math.PI);
      const dLng = dLat / Math.max(0.01, Math.cos(toRad(lat)));
      extend(lng - dLng, lat - dLat);
      extend(lng + dLng, lat + dLat);
      continue;
    }
    walkPositions(geometry.coordinates, ([lng, lat]) => extend(lng, lat));
  }

  return seen ? { north, south, east, west } : null;
}

/** A representative point for "jump to this shape" — centre of its bounding box. */
export function centroidOf(geometry: GeoGeometry | GeofenceGeometry): LatLng | null {
  if (geometry.type === 'Point') {
    const [lng, lat] = geometry.coordinates;
    return { lat, lng };
  }
  if (geometry.type === 'Circle') {
    const [lng, lat] = geometry.center;
    return { lat, lng };
  }
  const bounds = boundsOf([geometry]);
  if (!bounds) return null;
  return { lat: (bounds.north + bounds.south) / 2, lng: (bounds.east + bounds.west) / 2 };
}
