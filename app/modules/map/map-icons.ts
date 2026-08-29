/**
 * The map's icon catalogue — one filled 24×24 path per key.
 *
 * Filled silhouettes rather than the stroked outlines used elsewhere in the app:
 * these render at roughly 12px inside a marker pin, where a 2px stroke turns to
 * mush. Keys are stored in the database (`MapCategory.icon`, `MapFeature.icon`,
 * `MapDeviceTag.icon`), so renaming one orphans existing rows — add, don't rename.
 *
 * Single source of truth for the picker, the map markers and the panel chips, in
 * the same spirit as CATEGORY_META in trip-planning.
 */

export interface MapIcon {
  label: string;
  /** Path data for a 24×24 viewBox, filled with currentColor. */
  path: string;
}

export const MAP_ICONS = {
  pin: {
    label: 'Dot',
    path: 'M12 6.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11z',
  },
  square: {
    label: 'Square',
    path: 'M6.5 6.5h11v11h-11z',
  },
  triangle: {
    label: 'Triangle',
    path: 'M12 5l7 13H5L12 5z',
  },
  diamond: {
    label: 'Diamond',
    path: 'M12 4l8 8-8 8-8-8 8-8z',
  },
  star: {
    label: 'Star',
    path: 'M12 3.5l2.7 5.6 6.1.9-4.4 4.3 1 6.2-5.4-2.9-5.4 2.9 1-6.2L3.2 10l6.1-.9L12 3.5z',
  },
  person: {
    label: 'Person',
    path: 'M12 3.5a3.6 3.6 0 100 7.2 3.6 3.6 0 000-7.2zM4.4 20.5a7.6 7.6 0 0115.2 0H4.4z',
  },
  team: {
    label: 'Team',
    path: 'M8.2 4a3 3 0 100 6 3 3 0 000-6zm7.8 1.2a2.6 2.6 0 100 5.2 2.6 2.6 0 000-5.2zM2 19.4a6.2 6.2 0 0112.4 0v.6H2v-.6zm14 .6v-.6c0-1.9-.7-3.6-1.9-4.9a5.3 5.3 0 017.9 4.6v.9H16z',
  },
  vehicle: {
    label: 'Vehicle',
    path: 'M6 7h12l2 5v5.5h-2.6V16H6.6v1.5H4V12l2-5zm.9 4.5h10.2l-1.1-2.7H8l-1.1 2.7zM7 15.3a1.35 1.35 0 100-2.7 1.35 1.35 0 000 2.7zm10 0a1.35 1.35 0 100-2.7 1.35 1.35 0 000 2.7z',
  },
  truck: {
    label: 'Truck',
    path: 'M2 6h11v9H2V6zm12 2.5h3.6L21 12v3h-7V8.5zM6.8 18.4a1.6 1.6 0 100-3.2 1.6 1.6 0 000 3.2zm10.6 0a1.6 1.6 0 100-3.2 1.6 1.6 0 000 3.2z',
  },
  aircraft: {
    label: 'Aircraft',
    path: 'M21 14.5v-2l-7.5-4.7V3.6a1.5 1.5 0 00-3 0v4.2L3 12.5v2l7.5-2.3v4.4l-2.2 1.6V20l3.7-1.1 3.7 1.1v-1.8l-2.2-1.6v-4.4L21 14.5z',
  },
  anchor: {
    label: 'Port',
    path: 'M11 6.6a2.4 2.4 0 112 0V9h2.5v2H13v6.3a5.6 5.6 0 004-4.5h-1.6l2.6-3.3L20.6 13H19a7.6 7.6 0 01-7 6.9A7.6 7.6 0 015 13H3.4l2.6-3.5L8.6 13H7a5.6 5.6 0 004 4.5V11H8.5V9H11V6.6z',
  },
  building: {
    label: 'Building',
    path: 'M5 3.5h9V21H5V3.5zm10 6h4V21h-4V9.5zM7.4 6h2v2h-2V6zm3.2 0h2v2h-2V6zM7.4 10h2v2h-2v-2zm3.2 0h2v2h-2v-2zm-3.2 4h2v2h-2v-2zm3.2 0h2v2h-2v-2z',
  },
  warehouse: {
    label: 'Warehouse',
    path: 'M12 3.5l9 4.8V21h-5.5v-6h-7v6H3V8.3l9-4.8zM10 17h4v4h-4v-4z',
  },
  home: {
    label: 'Home',
    path: 'M12 3l9.5 8.4-1.5 1.7-1-.9V21h-5v-6h-4v6H5v-8.8l-1 .9-1.5-1.7L12 3z',
  },
  tent: {
    label: 'Camp',
    path: 'M12 3.5L21.5 20H14l-2-3.6L10 20H2.5L12 3.5z',
  },
  shield: {
    label: 'Security',
    path: 'M12 2.8l8 3.3v5.2c0 4.7-3.2 8.7-8 10-4.8-1.3-8-5.3-8-10V6.1l8-3.3z',
  },
  barrier: {
    label: 'Checkpoint',
    path: 'M3 4h2.4v16H3V4zm3.6 2.6h14.8v4.8H6.6V6.6zm0 0l4.4 4.8h3L6.6 6.6zm7.4 0l4.4 4.8h3L14 6.6z',
  },
  radio: {
    label: 'Radio',
    path: 'M12 9.6a2.4 2.4 0 100 4.8 2.4 2.4 0 000-4.8zM6.8 4.4l1.5 1.6a7.4 7.4 0 000 12l-1.5 1.6a9.6 9.6 0 010-15.2zm10.4 0a9.6 9.6 0 010 15.2l-1.5-1.6a7.4 7.4 0 000-12l1.5-1.6z',
  },
  tower: {
    label: 'Tower',
    path: 'M10.6 3h2.8l.6 4h2.5l.6 3h-2.7l1.9 11h-2.7L12 13.5 10.4 21H7.7l1.9-11H6.9l.6-3H10L10.6 3z',
  },
  camera: {
    label: 'Camera',
    path: 'M9.3 4.5h5.4l1.3 2.2H20a1.6 1.6 0 011.6 1.6v9.6A1.6 1.6 0 0120 19.5H4A1.6 1.6 0 012.4 17.9V8.3A1.6 1.6 0 014 6.7h4L9.3 4.5zM12 9a4.1 4.1 0 100 8.2A4.1 4.1 0 0012 9z',
  },
  fuel: {
    label: 'Fuel',
    path: 'M4 3.5h9V21H4V3.5zM6.2 6h4.6v3.5H6.2V6zm9.3-1.4l3 3V16a1.6 1.6 0 01-3.2 0v-3.5H14V5.5l1.5-.9z',
  },
  medical: {
    label: 'Medical',
    path: 'M9.8 3h4.4v6.8H21v4.4h-6.8V21H9.8v-6.8H3V9.8h6.8V3z',
  },
  alert: {
    label: 'Alert',
    path: 'M12 3l9.8 17.5H2.2L12 3zm-1.1 6.2v5.4h2.2V9.2h-2.2zm0 7v2.2h2.2v-2.2h-2.2z',
  },
  flag: {
    label: 'Flag',
    path: 'M4.6 3h2.2v18H4.6V3zm3.4 1h11l-2.4 3.9L19 12H8V4z',
  },
  water: {
    label: 'Water',
    path: 'M12 3s6.6 7 6.6 11.1A6.6 6.6 0 115.4 14C5.4 10 12 3 12 3z',
  },
  tree: {
    label: 'Vegetation',
    path: 'M12 3l4.6 6.4h-2.4l4.2 5.9H5.6l4.2-5.9H7.4L12 3zm-1.2 12.9h2.4V21h-2.4v-5.1z',
  },
} as const satisfies Record<string, MapIcon>;

export type MapIconKey = keyof typeof MAP_ICONS;

export const MAP_ICON_KEYS = Object.keys(MAP_ICONS) as MapIconKey[];

export const DEFAULT_MAP_ICON: MapIconKey = 'pin';

/** Resolve a stored key, falling back to the default when a row predates a rename. */
export function mapIconPath(key: string | null | undefined): string {
  return MAP_ICONS[(key ?? '') as MapIconKey]?.path ?? MAP_ICONS[DEFAULT_MAP_ICON].path;
}

/**
 * Build the glyph element for a marker pin. Returns a real SVG element rather
 * than markup, so nothing is ever parsed from a string into the DOM.
 */
export function mapIconElement(key: string | null | undefined, color = '#ffffff'): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '15');
  svg.setAttribute('height', '15');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', mapIconPath(key));
  path.setAttribute('fill', color);
  svg.appendChild(path);
  return svg;
}
