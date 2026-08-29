import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MAP_ICON,
  MAP_ICONS,
  MAP_ICON_KEYS,
  mapIconPath,
} from '../app/modules/map/map-icons';

describe('MAP_ICONS', () => {
  it('offers enough icons to categorise a real operation', () => {
    expect(MAP_ICON_KEYS.length).toBeGreaterThanOrEqual(20);
  });

  it('gives every icon a label and a path', () => {
    for (const key of MAP_ICON_KEYS) {
      expect(MAP_ICONS[key].label, key).toMatch(/\S/);
      expect(MAP_ICONS[key].path, key).toMatch(/^M[\d.\-\s]/);
    }
  });

  it('has no two icons sharing a path', () => {
    // A copy-paste slip here makes two categories indistinguishable on the map.
    const paths = MAP_ICON_KEYS.map((key) => MAP_ICONS[key].path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('has no two icons sharing a label', () => {
    const labels = MAP_ICON_KEYS.map((key) => MAP_ICONS[key].label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('uses only path commands that are valid in a 24x24 viewBox', () => {
    for (const key of MAP_ICON_KEYS) {
      expect(MAP_ICONS[key].path, key).not.toMatch(/[^MmLlHhVvCcSsQqTtAaZz0-9.,\-\s]/);
    }
  });
});

describe('mapIconPath', () => {
  it('resolves a known key', () => {
    expect(mapIconPath('shield')).toBe(MAP_ICONS.shield.path);
  });

  it('falls back to the default for a key that no longer exists', () => {
    // Rows keep whatever key they were saved with; a stale one must not blank the marker.
    expect(mapIconPath('removed-in-a-later-release')).toBe(MAP_ICONS[DEFAULT_MAP_ICON].path);
    expect(mapIconPath(null)).toBe(MAP_ICONS[DEFAULT_MAP_ICON].path);
    expect(mapIconPath(undefined)).toBe(MAP_ICONS[DEFAULT_MAP_ICON].path);
  });
});
