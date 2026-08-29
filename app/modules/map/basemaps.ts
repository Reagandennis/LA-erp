/**
 * Free raster tile sources — no API key, no billing account.
 *
 * Attribution is a licence condition for every one of these, not decoration:
 * Leaflet renders it from the `attribution` field, so it must not be stripped.
 * OSM's tile policy also asks for a real referrer and modest volume, which an
 * internal ops tool comfortably stays inside.
 */

export interface TileSource {
  label: string;
  url: string;
  attribution: string;
  maxZoom: number;
  /** Subdomain letters for {s}, where the provider offers them. */
  subdomains?: string;
}

const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/**
 * CARTO serves watermarked tiles without a key. The key is public by nature —
 * tiles are fetched by the browser, so it is inlined into the client bundle like
 * any NEXT_PUBLIC_ value; CARTO's quota, not secrecy, is what bounds it.
 * Everything still works unkeyed, just watermarked.
 */
const CARTO_KEY = process.env.NEXT_PUBLIC_CARTO_API_KEY;

function carto(style: string): string {
  const url = `https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}.png`;
  return CARTO_KEY ? `${url}?key=${CARTO_KEY}` : url;
}

export const BASEMAP_SOURCES = {
  streets: {
    label: 'Streets',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: OSM_ATTRIBUTION,
    maxZoom: 19,
  },
  light: {
    label: 'Light',
    url: carto('light_all'),
    attribution: `${OSM_ATTRIBUTION} &copy; <a href="https://carto.com/attributions">CARTO</a>`,
    maxZoom: 20,
    subdomains: 'abcd',
  },
  satellite: {
    label: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
    maxZoom: 19,
  },
  terrain: {
    label: 'Terrain',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: `${OSM_ATTRIBUTION}, <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)`,
    maxZoom: 17,
    subdomains: 'abc',
  },
} as const satisfies Record<string, TileSource>;

export type Basemap = keyof typeof BASEMAP_SOURCES;

export const BASEMAPS = (Object.keys(BASEMAP_SOURCES) as Basemap[]).map((value) => ({
  value,
  label: BASEMAP_SOURCES[value].label,
}));

/**
 * Semi-transparent layers drawn over the basemap. They credit only their own
 * provider — the basemap underneath already carries the OpenStreetMap notice,
 * and Leaflet would otherwise print it twice.
 */
export const OVERLAY_SOURCES = {
  cycling: {
    label: 'Cycling',
    url: 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
    attribution: '<a href="https://www.cyclosm.org/">CyclOSM</a>',
    maxZoom: 20,
    subdomains: 'abc',
  },
  transit: {
    label: 'Transit',
    url: 'https://tileserver.memomaps.de/tilegen/{z}/{x}/{y}.png',
    attribution: '<a href="https://memomaps.de/">MeMoMaps</a>',
    maxZoom: 18,
  },
} as const satisfies Record<string, TileSource>;

export type OverlayKey = keyof typeof OVERLAY_SOURCES;

export const OVERLAYS = (Object.keys(OVERLAY_SOURCES) as OverlayKey[]).map((value) => ({
  value,
  label: OVERLAY_SOURCES[value].label,
}));
