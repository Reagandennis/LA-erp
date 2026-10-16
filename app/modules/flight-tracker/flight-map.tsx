'use client';

import 'leaflet/dist/leaflet.css';

import type * as Leaflet from 'leaflet';
import { useEffect, useRef, useState } from 'react';

import { BASEMAP_SOURCES } from '../map/basemaps';
import {
  type Bounds,
  type FlightRecord,
  flightLabel,
  greatCircle,
  isOnGround,
} from './flight-data';

/** Pixels of the map hidden under the floating panels. */
export type Insets = { top: number; right: number; bottom: number; left: number };

/**
 * A one-off camera move; a new `nonce` repeats it. `route` frames the selected
 * flight end to end, `plane` centres it at the current zoom, `flights` frames
 * every result and `area` frames the searched area.
 */
export type FrameRequest = { kind: 'route' | 'plane' | 'flights' | 'area'; nonce: number };

const ESRI_CANVAS = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas';

/** Both keyless, from the host the Map module's satellite layer already uses. */
const BASEMAPS = {
  satellite: { ...BASEMAP_SOURCES.satellite, className: 'ft-tiles-satellite', labels: null },
  dark: {
    label: 'Map',
    url: `${ESRI_CANVAS}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    labels: `${ESRI_CANVAS}/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
    attribution: 'Esri, HERE, Garmin, &copy; OpenStreetMap contributors',
    maxZoom: 16,
    className: '',
  },
} as const;
type Basemap = keyof typeof BASEMAPS;

/** Material "flight" glyph, nose up, so rotating by the track points it along its heading. */
export const PLANE_PATH =
  'M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z';

const FLOWN_FROM = [232, 72, 58]; // red-orange
const FLOWN_TO = [249, 178, 50]; // brand yellow

let leafletPromise: Promise<typeof Leaflet> | null = null;
function loadLeaflet(): Promise<typeof Leaflet> {
  // Leaflet touches `document` as it loads, so it is imported on the client only.
  leafletPromise ??= import('leaflet').then((mod) => (mod.default ?? mod) as typeof Leaflet);
  return leafletPromise;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

function planeIcon(L: typeof Leaflet, flight: FlightRecord, selected: boolean): Leaflet.DivIcon {
  const size = selected ? 36 : 24;
  const fill = selected ? '#F9B232' : isOnGround(flight) ? 'rgba(255,255,255,0.5)' : '#FFFFFF';
  return L.divIcon({
    className: selected ? 'ft-plane ft-plane--selected' : 'ft-plane',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html:
      `<svg viewBox="0 0 24 24" width="${size}" height="${size}" style="transform:rotate(${flight.track ?? 0}deg)">` +
      `<path d="${PLANE_PATH}" fill="${fill}" stroke="rgba(0,0,0,0.55)" stroke-width="0.9" stroke-linejoin="round"/></svg>`,
  });
}

function airportIcon(L: typeof Leaflet, code: string): Leaflet.DivIcon {
  return L.divIcon({
    className: 'ft-airport',
    iconSize: [12, 12],
    iconAnchor: [6, 6],
    html: `<span class="ft-airport-dot"></span><span class="ft-airport-code">${esc(code)}</span>`,
  });
}

export default function FlightMap({
  flights,
  selected,
  onSelect,
  area,
  follow,
  frame,
  getInsets,
  onUserMove,
}: {
  flights: FlightRecord[];
  selected: FlightRecord | null;
  onSelect: (id: string) => void;
  /** The browsed area; the map opens on it. */
  area: Bounds;
  /** Keep the selected aircraft in view as its position updates. */
  follow: boolean;
  frame: FrameRequest | null;
  getInsets: () => Insets;
  /** The part of the map left visible between the panels, after the user pans or zooms. */
  onUserMove: (visible: Bounds) => void;
}) {
  const divRef = useRef<HTMLDivElement>(null);
  const LRef = useRef<typeof Leaflet | null>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const tilesRef = useRef<Leaflet.TileLayer[]>([]);
  const markersRef = useRef<Map<string, Leaflet.Marker>>(new Map());
  const routeRef = useRef<Leaflet.LayerGroup | null>(null);
  // Moves we make ourselves (framing, following) must not offer "Search this area".
  const programmaticUntil = useRef(0);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [basemap, setBasemap] = useState<Basemap>('satellite');

  // Latest callbacks for handlers that Leaflet binds once.
  const callbacks = useRef({ onSelect, getInsets, onUserMove });
  useEffect(() => {
    callbacks.current = { onSelect, getInsets, onUserMove };
  }, [onSelect, getInsets, onUserMove]);

  // Latest props for the camera moves, which run only when a new request arrives.
  const latest = useRef({ area, flights, selected });
  useEffect(() => {
    latest.current = { area, flights, selected };
  }, [area, flights, selected]);

  /* ---------------------------------------------------------------- bootstrap */

  useEffect(() => {
    let cancelled = false;
    loadLeaflet()
      .then((L) => {
        if (cancelled || !divRef.current || mapRef.current) return;
        LRef.current = L;
        const map = L.map(divRef.current, {
          zoomControl: false,
          attributionControl: false,
          worldCopyJump: true,
          minZoom: 2,
        });
        mapRef.current = map;
        routeRef.current = L.layerGroup().addTo(map);
        const b = latest.current.area;
        map.fitBounds(
          [
            [b.lamin, b.lomin],
            [b.lamax, b.lomax],
          ],
          { animate: false },
        );
        map.on('moveend', () => {
          if (Date.now() < programmaticUntil.current) return;
          callbacks.current.onUserMove(visibleBounds(map, callbacks.current.getInsets()));
        });
        setReady(true);
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () => () => {
      mapRef.current?.remove();
      mapRef.current = null;
    },
    [],
  );

  // The map's box changes with the layout (sidebar, phone vs desktop).
  useEffect(() => {
    const div = divRef.current;
    if (!ready || !div) return;
    const observer = new ResizeObserver(() => mapRef.current?.invalidateSize());
    observer.observe(div);
    return () => observer.disconnect();
  }, [ready]);

  /* ------------------------------------------------------------------ basemap */

  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map) return;
    const source = BASEMAPS[basemap];
    for (const layer of tilesRef.current) layer.remove();
    const base = L.tileLayer(source.url, { maxZoom: source.maxZoom, className: source.className }).addTo(map);
    base.bringToBack();
    tilesRef.current = [base];
    if (source.labels) tilesRef.current.push(L.tileLayer(source.labels, { maxZoom: source.maxZoom }).addTo(map));
  }, [basemap, ready]);

  /* ------------------------------------------------------------------ aircraft */

  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map) return;
    const markers = markersRef.current;
    const seen = new Set<string>();
    for (const flight of flights) {
      if (flight.lat === null || flight.lon === null) continue;
      seen.add(flight.id);
      const isSelected = flight.id === selected?.id;
      const icon = planeIcon(L, flight, isSelected);
      let marker = markers.get(flight.id);
      if (!marker) {
        marker = L.marker([flight.lat, flight.lon], { icon, keyboard: true, title: flightLabel(flight) })
          .on('click', () => callbacks.current.onSelect(flight.id))
          .bindTooltip(flightLabel(flight), { direction: 'top', offset: [0, -12], className: 'ft-tip', opacity: 1 })
          .addTo(map);
        markers.set(flight.id, marker);
      } else {
        marker.setLatLng([flight.lat, flight.lon]);
        marker.setIcon(icon);
        marker.setTooltipContent(flightLabel(flight));
      }
      marker.setZIndexOffset(isSelected ? 1000 : 0);
    }
    for (const [id, marker] of markers) {
      if (!seen.has(id)) {
        marker.remove();
        markers.delete(id);
      }
    }
  }, [flights, selected?.id, ready]);

  /* -------------------------------------------------------------------- route */

  useEffect(() => {
    const L = LRef.current;
    const group = routeRef.current;
    if (!ready || !L || !group) return;
    group.clearLayers();
    if (!selected || selected.lat === null || selected.lon === null) return;
    const here = { lat: selected.lat, lon: selected.lon };

    if (selected.origin) {
      const flown = greatCircle(selected.origin, here, 40);
      L.polyline(flown, { color: '#000', opacity: 0.35, weight: 7, interactive: false }).addTo(group);
      // Leaflet has no gradient stroke, so the flown leg is drawn as short tinted pieces.
      for (let i = 0; i < flown.length - 1; i++) {
        const t = i / (flown.length - 2 || 1);
        const rgb = FLOWN_FROM.map((from, k) => Math.round(from + (FLOWN_TO[k] - from) * t));
        L.polyline([flown[i], flown[i + 1]], {
          color: `rgb(${rgb.join(',')})`,
          weight: 3.5,
          lineCap: 'round',
          interactive: false,
        }).addTo(group);
      }
      L.marker([selected.origin.lat, selected.origin.lon], {
        icon: airportIcon(L, selected.origin.iata),
        interactive: false,
      }).addTo(group);
    }
    if (selected.destination) {
      L.polyline(greatCircle(here, selected.destination, 40), {
        color: '#FFFFFF',
        opacity: 0.6,
        weight: 2,
        dashArray: '4 8',
        interactive: false,
      }).addTo(group);
      L.marker([selected.destination.lat, selected.destination.lon], {
        icon: airportIcon(L, selected.destination.iata),
        interactive: false,
      }).addTo(group);
    }
  }, [selected, ready]);

  /* ------------------------------------------------------------------ framing */

  const fit = (points: Array<[number, number]>, maxZoom: number) => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map || points.length === 0) return;
    const insets = callbacks.current.getInsets();
    programmaticUntil.current = Date.now() + 900;
    map.fitBounds(L.latLngBounds(points), {
      paddingTopLeft: [insets.left + 48, insets.top + 48],
      paddingBottomRight: [insets.right + 48, insets.bottom + 72],
      maxZoom,
    });
  };

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !frame) return;
    const { area: b, flights: all, selected: flight } = latest.current;
    if (frame.kind === 'area') {
      fit(
        [
          [b.lamin, b.lomin],
          [b.lamax, b.lomax],
        ],
        12,
      );
    } else if (frame.kind === 'flights') {
      fit(all.flatMap((f) => (f.lat !== null && f.lon !== null ? [[f.lat, f.lon] as [number, number]] : [])), 7);
    } else if (flight && flight.lat !== null && flight.lon !== null) {
      const here = { lat: flight.lat, lon: flight.lon };
      if (frame.kind === 'plane') {
        fit([[here.lat, here.lon]], map.getZoom());
      } else {
        fit(
          [
            ...(flight.origin ? greatCircle(flight.origin, here, 12) : []),
            [here.lat, here.lon],
            ...(flight.destination ? greatCircle(here, flight.destination, 12) : []),
          ],
          8,
        );
      }
    }
  }, [frame, ready]);

  // Following keeps the zoom the user chose and only re-centres.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !follow || !selected || selected.lat === null || selected.lon === null) return;
    fit([[selected.lat, selected.lon]], map.getZoom());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [follow, selected?.lat, selected?.lon, ready]);

  const zoom = (delta: number) => {
    const map = mapRef.current;
    if (map) map.setZoom(map.getZoom() + delta);
  };

  return (
    <div className="ft-map absolute inset-0 isolate">
      <style>{MAP_CSS}</style>
      <div ref={divRef} className="absolute inset-0" />
      {failed && (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-white/60">
          The map could not be loaded.
        </p>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[1000] flex flex-col items-center gap-1.5 pb-2">
        <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-[#151518]/90 p-1 text-sm shadow-lg ring-1 ring-white/10 backdrop-blur">
          <button type="button" onClick={() => zoom(-1)} aria-label="Zoom out" className={roundButtonClass}>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M5 12h14" />
            </svg>
          </button>
          <button type="button" onClick={() => zoom(1)} aria-label="Zoom in" className={roundButtonClass}>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <span className="mx-1 h-5 w-px bg-white/10" />
          <div role="group" aria-label="Map style" className="flex">
            {(Object.keys(BASEMAPS) as Basemap[]).map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={basemap === key}
                onClick={() => setBasemap(key)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                  basemap === key ? 'bg-white/15 text-white' : 'text-white/55 hover:text-white'
                }`}
              >
                {BASEMAPS[key].label}
              </button>
            ))}
          </div>
        </div>
        {/* Tile attribution is a licence condition; Leaflet's own control would sit under a panel. */}
        <p
          className="ft-attribution pointer-events-auto max-w-[90%] truncate rounded px-1.5 text-center text-[10px] text-white/45"
          dangerouslySetInnerHTML={{ __html: BASEMAPS[basemap].attribution }}
        />
      </div>
    </div>
  );
}

const roundButtonClass =
  'flex h-8 w-8 items-center justify-center rounded-full text-white/75 transition-colors hover:bg-white/10 hover:text-white';

function visibleBounds(map: Leaflet.Map, insets: Insets): Bounds {
  const size = map.getSize();
  const nw = map.containerPointToLatLng([insets.left, insets.top]);
  const se = map.containerPointToLatLng([Math.max(insets.left + 1, size.x - insets.right), Math.max(insets.top + 1, size.y - insets.bottom)]);
  const round = (n: number) => Math.round(n * 100) / 100;
  return { lamin: round(se.lat), lomin: round(nw.lng), lamax: round(nw.lat), lomax: round(se.lng) };
}

const MAP_CSS = `
  .ft-map .leaflet-container { background: #0b0d10; font: inherit; }
  .ft-map .ft-tiles-satellite { filter: brightness(0.62) saturate(0.8) contrast(1.05); }
  .ft-map .ft-plane { background: none; border: 0; }
  .ft-map .ft-plane svg { display: block; transition: transform 0.6s ease; }
  .ft-map .ft-plane--selected svg { filter: drop-shadow(0 0 0.5rem rgba(249, 178, 50, 0.65)); }
  .ft-map .ft-airport { background: none; border: 0; }
  .ft-map .ft-airport-dot {
    position: absolute; inset: 0; border-radius: 9999px;
    background: #fff; box-shadow: 0 0 0 3px rgba(11, 13, 16, 0.75);
  }
  .ft-map .ft-airport-code {
    position: absolute; left: 18px; top: 50%; transform: translateY(-50%);
    padding: 2px 6px; border-radius: 6px; background: rgba(21, 21, 24, 0.9);
    color: #fff; font: 600 11px/1.3 var(--font-geist-mono), ui-monospace, monospace; letter-spacing: 0.04em;
    white-space: nowrap;
  }
  .ft-map .leaflet-tooltip.ft-tip {
    background: #151518; color: #fff; border: 0; border-radius: 8px; box-shadow: 0 6px 16px rgba(0, 0, 0, 0.45);
    font: 600 11px/1.3 var(--font-geist-mono), ui-monospace, monospace; padding: 4px 8px;
  }
  .ft-map .leaflet-tooltip-top.ft-tip::before { border-top-color: #151518; }
  .ft-attribution a { color: rgba(255, 255, 255, 0.7); }
  @media (prefers-reduced-motion: reduce) { .ft-map .ft-plane svg { transition: none; } }
`;
