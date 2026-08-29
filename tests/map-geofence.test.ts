import { describe, expect, it } from 'vitest';

import {
  boundsOf,
  centroidOf,
  haversineMeters,
  isInsideGeofence,
  pointInPolygon,
  pointInRing,
  type Ring,
} from '../lib/geo-geometry';

/** A 2°×2° square around the origin, closed. */
const SQUARE: Ring = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
];

/** A smaller square wholly inside SQUARE, used as a hole. */
const HOLE: Ring = [
  [-0.5, -0.5],
  [0.5, -0.5],
  [0.5, 0.5],
  [-0.5, 0.5],
  [-0.5, -0.5],
];

describe('haversineMeters', () => {
  it('is zero for identical points', () => {
    expect(haversineMeters({ lat: -1.29, lng: 36.82 }, { lat: -1.29, lng: 36.82 })).toBe(0);
  });

  it('matches the known Nairobi → Mombasa distance to within 1%', () => {
    const d = haversineMeters({ lat: -1.2921, lng: 36.8219 }, { lat: -4.0435, lng: 39.6682 });
    expect(d).toBeGreaterThan(435_000);
    expect(d).toBeLessThan(445_000);
  });

  it('does not blow up on antipodal points', () => {
    const d = haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 180 });
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeGreaterThan(20_000_000);
  });
});

describe('pointInRing', () => {
  it('accepts an interior point and rejects an exterior one', () => {
    expect(pointInRing({ lat: 0, lng: 0 }, SQUARE)).toBe(true);
    expect(pointInRing({ lat: 5, lng: 5 }, SQUARE)).toBe(false);
  });

  it('counts a point sitting exactly on an edge as inside', () => {
    // A device parked on the fence line must not be reported as having left it.
    expect(pointInRing({ lat: 0, lng: 1 }, SQUARE)).toBe(true);
    expect(pointInRing({ lat: -1, lng: 0 }, SQUARE)).toBe(true);
  });

  it('counts a vertex as inside', () => {
    expect(pointInRing({ lat: 1, lng: 1 }, SQUARE)).toBe(true);
  });

  it('does not double-count when the ray passes through vertices', () => {
    // A diamond's east and west corners share the ray's latitude, so a naive
    // implementation flips its parity twice at each and reports "inside".
    const diamond: Ring = [
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
      [0, 1],
    ];
    expect(pointInRing({ lat: 0, lng: -5 }, diamond)).toBe(false);
    expect(pointInRing({ lat: 0, lng: 0 }, diamond)).toBe(true);
    // Level with the square's top edge but well to the west of it.
    expect(pointInRing({ lat: 1, lng: -5 }, SQUARE)).toBe(false);
  });

  it('rejects a degenerate ring', () => {
    expect(pointInRing({ lat: 0, lng: 0 }, [[0, 0], [1, 1]])).toBe(false);
  });
});

describe('pointInPolygon', () => {
  it('treats a point inside a hole as outside the polygon', () => {
    expect(pointInPolygon({ lat: 0, lng: 0 }, [SQUARE])).toBe(true);
    expect(pointInPolygon({ lat: 0, lng: 0 }, [SQUARE, HOLE])).toBe(false);
  });

  it('keeps a point between the hole and the outer ring inside', () => {
    expect(pointInPolygon({ lat: 0.75, lng: 0.75 }, [SQUARE, HOLE])).toBe(true);
  });

  it('rejects an empty coordinate list', () => {
    expect(pointInPolygon({ lat: 0, lng: 0 }, [])).toBe(false);
  });
});

describe('isInsideGeofence', () => {
  it('respects a circle radius on both sides of the boundary', () => {
    const fence = { type: 'Circle' as const, center: [36.8219, -1.2921] as [number, number], radius: 1000 };
    const centre = { lat: -1.2921, lng: 36.8219 };

    expect(isInsideGeofence(fence, centre)).toBe(true);

    // ~900m and ~1100m due north of the centre.
    const degPer100m = 0.000899;
    expect(isInsideGeofence(fence, { lat: centre.lat + degPer100m * 9, lng: centre.lng })).toBe(true);
    expect(isInsideGeofence(fence, { lat: centre.lat + degPer100m * 11, lng: centre.lng })).toBe(false);
  });

  it('handles polygon fences through pointInPolygon', () => {
    const fence = { type: 'Polygon' as const, coordinates: [SQUARE] };
    expect(isInsideGeofence(fence, { lat: 0.5, lng: 0.5 })).toBe(true);
    expect(isInsideGeofence(fence, { lat: 2, lng: 2 })).toBe(false);
  });
});

describe('boundsOf', () => {
  it('frames a mix of geometry types', () => {
    expect(
      boundsOf([
        { type: 'Point', coordinates: [36.8, -1.3] },
        { type: 'LineString', coordinates: [[37.2, -1.0], [36.5, -1.5]] },
      ]),
    ).toEqual({ north: -1.0, south: -1.5, east: 37.2, west: 36.5 });
  });

  it('frames a circle by its bounding square', () => {
    const bounds = boundsOf([{ type: 'Circle', center: [36.82, -1.29], radius: 1000 }]);
    if (!bounds) throw new Error('expected bounds');
    expect(bounds.north).toBeGreaterThan(-1.29);
    expect(bounds.south).toBeLessThan(-1.29);
    expect(bounds.east).toBeGreaterThan(36.82);
  });

  it('returns null when there is nothing to frame', () => {
    expect(boundsOf([])).toBeNull();
  });
});

describe('centroidOf', () => {
  it('returns a point unchanged', () => {
    expect(centroidOf({ type: 'Point', coordinates: [36.82, -1.29] })).toEqual({
      lat: -1.29,
      lng: 36.82,
    });
  });

  it('returns the centre of a polygon bounding box', () => {
    expect(centroidOf({ type: 'Polygon', coordinates: [SQUARE] })).toEqual({ lat: 0, lng: 0 });
  });
});
