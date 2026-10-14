'use client';

import { APP_LOCALE } from '@/lib/locale';
import 'leaflet/dist/leaflet.css';

import type * as Leaflet from 'leaflet';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { GeoGeometry, GeofenceGeometry, LatLngBounds, Position, Ring } from '@/lib/geo-geometry';
import {
  DEFAULT_STYLE,
  dashArray,
  resolveStyle,
  type MapCategoryDto,
  type MapDeviceTagDto,
  type MapFeatureDto,
  type MapGeofenceDto,
  type MapLayerDto,
  type MapStyle,
  type TrackedDevice,
} from '@/lib/map-types';

import { BASEMAP_SOURCES, OVERLAY_SOURCES, type Basemap, type OverlayKey } from './basemaps';
import { darken } from './map-format';
import { mapIconPath } from './map-icons';
import type { DrawMode, DrawTarget, DrawnShape, MapFocus, OverlayToggles, Selection } from './types';

const NAIROBI: [number, number] = [-1.2921, 36.8219];

/**
 * Leaflet reaches for `document` as it initialises, so it cannot be imported at
 * module scope in a component Next still renders on the server.
 */
let leafletPromise: Promise<typeof Leaflet> | null = null;
function loadLeaflet(): Promise<typeof Leaflet> {
  leafletPromise ??= import('leaflet').then((mod) => (mod.default ?? mod) as typeof Leaflet);
  return leafletPromise;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

/** Teardrop pin holding either a catalogue glyph or a roster number. */
function pinHtml(color: string, glyph: { icon: string } | { number: number }, scale = 1): string {
  const w = 30 * scale;
    const h = 40 * scale;
  const inner =
    'icon' in glyph
      ? `<svg x="7.5" y="6" width="15" height="15" viewBox="0 0 24 24"><path d="${mapIconPath(glyph.icon)}" fill="#fff"/></svg>`
      : `<text x="15" y="21" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" font-weight="700" fill="#fff">${glyph.number}</text>`;
  return (
    `<svg width="${w}" height="${h}" viewBox="0 0 30 40" xmlns="http://www.w3.org/2000/svg">` +
    `<path d="M15 39.5C15 39.5 29 24.5 29 14.5A14 14 0 1 0 1 14.5C1 24.5 15 39.5 15 39.5Z" ` +
    `fill="${esc(color)}" stroke="${esc(darken(color))}" stroke-width="1.5"/>` +
    inner +
    `</svg>`
  );
}

/** Leaflet wants [lat, lng]; GeoJSON stores [lng, lat]. */
function toLatLngs(ring: Position[]): Array<[number, number]> {
  return ring.map(([lng, lat]) => [lat, lng]);
}

function ringFromLatLngs(latlngs: Leaflet.LatLng[]): Ring {
  const ring: Ring = latlngs.map((ll) => [ll.lng, ll.lat] as Position);
  if (ring.length > 0) {
    const [fx, fy] = ring[0];
    const [lx, ly] = ring[ring.length - 1];
    if (fx !== lx || fy !== ly) ring.push([fx, fy]);
  }
  return ring;
}

function pathOptions(style: MapStyle): Leaflet.PathOptions {
  const dashes = dashArray(style.strokeDash, style.strokeWidth);
  return {
    color: style.stroke,
    weight: style.strokeWidth,
    opacity: 1,
    fillColor: style.fill,
    fillOpacity: style.fillOpacity,
    // Unlike Google's data layer, Leaflet dashes every shape type.
    dashArray: dashes ? dashes.join(' ') : undefined,
  };
}

interface OverlayRecord {
  layer: Leaflet.Layer;
  handles: Leaflet.Marker[];
  signature: string;
}

export interface MapCanvasProps {
  devices: TrackedDevice[];
  deviceTags: Record<string, MapDeviceTagDto>;
  categories: Record<number, MapCategoryDto>;
  hiddenCategoryIds: number[];
  layers: MapLayerDto[];
  featuresByLayer: Record<number, MapFeatureDto[]>;
  geofences: MapGeofenceDto[];
  occupancy: Record<number, string[]>;
  basemap: Basemap;
  overlays: OverlayToggles;
  drawMode: DrawMode | null;
  drawTarget: DrawTarget;
  selection: Selection | null;
  focus: MapFocus | null;
  fitBounds: { bounds: LatLngBounds; n: number } | null;
  onDrawComplete: (shape: DrawnShape) => void;
  onSelect: (selection: Selection | null) => void;
  onGeometryEdit: (kind: 'feature' | 'geofence', id: number, geometry: GeoGeometry | GeofenceGeometry) => void;
  children?: React.ReactNode;
}

export default function MapCanvas(props: MapCanvasProps) {
  const {
    devices,
    deviceTags,
    categories,
    hiddenCategoryIds,
    layers,
    featuresByLayer,
    geofences,
    occupancy,
    basemap,
    overlays,
    drawMode,
    drawTarget,
    selection,
    focus,
    fitBounds,
    onDrawComplete,
    onSelect,
    onGeometryEdit,
    children,
  } = props;

  const wrapperRef = useRef<HTMLDivElement>(null);
  const divRef = useRef<HTMLDivElement>(null);
  const LRef = useRef<typeof Leaflet | null>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const baseLayerRef = useRef<Leaflet.TileLayer | null>(null);
  const overlayRefs = useRef<Map<OverlayKey, Leaflet.TileLayer>>(new Map());

  const deviceMarkers = useRef<Map<string, Leaflet.Marker>>(new Map());
  const importedLayers = useRef<Map<number, Leaflet.GeoJSON>>(new Map());
  const drawnOverlays = useRef<Map<number, OverlayRecord>>(new Map());
  const geofenceOverlays = useRef<Map<number, OverlayRecord>>(new Map());
  const editingRef = useRef<string | null>(null);
  const drawTargetRef = useRef<DrawTarget>(drawTarget);
  const drawModeRef = useRef<DrawMode | null>(drawMode);
  // Latest values for the Leaflet handlers, which are bound once at init.
  useEffect(() => {
    drawTargetRef.current = drawTarget;
    drawModeRef.current = drawMode;
  }, [drawTarget, drawMode]);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hidden = new Set(hiddenCategoryIds);
  const isHidden = (categoryId: number | null) => categoryId !== null && hidden.has(categoryId);

  const styleOf = useCallback(
    (layer: MapLayerDto | undefined, override: Partial<MapStyle> | null, categoryId: number | null): MapStyle => {
      const base = layer?.style ?? DEFAULT_STYLE;
      const category = categoryId !== null ? categories[categoryId] : undefined;
      const tinted = category ? { ...base, stroke: category.color, fill: category.color } : base;
      return resolveStyle(tinted, override);
    },
    [categories],
  );

  /* --------------------------------------------------------------- bootstrap */

  useEffect(() => {
    let cancelled = false;
    loadLeaflet()
      .then((L) => {
        if (cancelled || !divRef.current || mapRef.current) return;
        LRef.current = L;
        const map = L.map(divRef.current, {
          center: NAIROBI,
          zoom: 6,
          zoomControl: true,
          // Our own drawing uses double-click; it is re-enabled when idle.
          doubleClickZoom: true,
        });
        mapRef.current = map;
        map.on('click', () => {
          if (!drawModeRef.current) onSelect(null);
        });
        setReady(true);
      })
      .catch(() => setError('The map library could not be loaded.'));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tear the map down only when the component really goes away.
  useEffect(
    () => () => {
      mapRef.current?.remove();
      mapRef.current = null;
    },
    [],
  );

  /* ------------------------------------------------------- basemap + overlays */

  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map) return;
    const source = BASEMAP_SOURCES[basemap];
    baseLayerRef.current?.remove();
    baseLayerRef.current = L.tileLayer(source.url, {
      attribution: source.attribution,
      maxZoom: source.maxZoom,
      subdomains: 'subdomains' in source ? (source.subdomains as string) : 'abc',
    }).addTo(map);
    baseLayerRef.current.bringToBack();
  }, [basemap, ready]);

  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map) return;
    for (const key of Object.keys(OVERLAY_SOURCES) as OverlayKey[]) {
      const on = overlays[key];
      const existing = overlayRefs.current.get(key);
      if (on && !existing) {
        const source = OVERLAY_SOURCES[key];
        const layer = L.tileLayer(source.url, {
          attribution: source.attribution,
          maxZoom: source.maxZoom,
          subdomains: 'subdomains' in source ? (source.subdomains as string) : 'abc',
          opacity: 0.75,
        }).addTo(map);
        overlayRefs.current.set(key, layer);
      } else if (!on && existing) {
        existing.remove();
        overlayRefs.current.delete(key);
      }
    }
  }, [overlays, ready]);

  /* -------------------------------------------------------------- device pins */

  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map) return;
    const markers = deviceMarkers.current;
    const seen = new Set<string>();

    devices.forEach((device, i) => {
      const tag = deviceTags[device.key];
      if (isHidden(tag?.categoryId ?? null)) return;
      seen.add(device.key);

      const category = tag?.categoryId != null ? categories[tag.categoryId] : undefined;
      const color = category?.color ?? '#03458f';
      const iconKey = tag?.icon ?? category?.icon;
      const selected = selection?.kind === 'device' && selection.id === device.key;
      const scale = selected ? 1.25 : 1;
      const label = tag?.label || device.name;

      const icon = L.divIcon({
        html: pinHtml(color, iconKey ? { icon: iconKey } : { number: i + 1 }, scale),
        className: '',
        iconSize: [30 * scale, 40 * scale],
        iconAnchor: [15 * scale, 40 * scale],
        popupAnchor: [0, -38 * scale],
      });

      const popup =
        `<div style="font:13px system-ui;min-width:140px">` +
        `<strong>${esc(label)}</strong>` +
        (category ? `<br/><span style="color:#6b7280">${esc(category.name)}</span>` : '') +
        `<br/><span style="color:#6b7280">${esc(new Date(device.at).toLocaleString(APP_LOCALE))}</span>` +
        (device.speedKph ? `<br/>${Math.round(device.speedKph)} km/h` : '') +
        (device.address ? `<br/>${esc(device.address)}` : '') +
        (device.accuracy ? `<br/><span style="color:#9ca3af">±${Math.round(device.accuracy)} m</span>` : '') +
        `<br/><span style="color:#9ca3af">via ${device.source === 'traccar' ? 'Traccar' : 'Zello'}</span>` +
        `</div>`;

      let marker = markers.get(device.key);
      if (!marker) {
        marker = L.marker([device.lat, device.lon], { icon, title: label }).addTo(map);
        marker.on('click', () => onSelect({ kind: 'device', id: device.key }));
        markers.set(device.key, marker);
      } else {
        marker.setLatLng([device.lat, device.lon]);
        marker.setIcon(icon);
      }
      marker.bindPopup(popup);
    });

    for (const [key, marker] of markers) {
      if (!seen.has(key)) {
        marker.remove();
        markers.delete(key);
      }
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devices, deviceTags, categories, hiddenCategoryIds, selection, ready]);

  /* --------------------------------------------------- imported layers (GeoJSON) */

  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map) return;

    for (const layer of layers) {
      if (layer.kind !== 'import') continue;
      const features = featuresByLayer[layer.id];
      if (!features) continue;

      importedLayers.current.get(layer.id)?.remove();
      if (!layer.visible) {
        importedLayers.current.delete(layer.id);
        continue;
      }

      const collection = {
        type: 'FeatureCollection',
        features: features
          .filter((f) => !isHidden(f.categoryId))
          .map((f) => ({
            type: 'Feature',
            id: f.id,
            geometry: f.geometry,
            properties: { id: f.id },
          })),
      } as unknown as Parameters<typeof L.geoJSON>[0];

      const geo = L.geoJSON(collection, {
          style: (feature) => {
            const source = features.find((f) => f.id === feature?.properties?.id);
            return pathOptions(styleOf(layer, source?.style ?? null, source?.categoryId ?? null));
          },
          pointToLayer: (feature, latlng) => {
            const source = features.find((f) => f.id === feature.properties?.id);
            const style = styleOf(layer, source?.style ?? null, source?.categoryId ?? null);
            const category = source?.categoryId != null ? categories[source.categoryId] : undefined;
            return L.marker(latlng, {
              icon: L.divIcon({
                html: pinHtml(style.stroke, { icon: source?.icon ?? category?.icon ?? 'pin' }, 0.8),
                className: '',
                iconSize: [24, 32],
                iconAnchor: [12, 32],
                popupAnchor: [0, -30],
              }),
            });
          },
          onEachFeature: (feature, lyr) => {
            const source = features.find((f) => f.id === feature.properties?.id);
            if (!source) return;
            lyr.bindPopup(
              `<div style="font:13px system-ui;max-width:240px">` +
                `<strong>${esc(source.name || 'Untitled')}</strong>` +
                (source.description ? `<br/><span style="color:#6b7280">${esc(source.description)}</span>` : '') +
                `</div>`,
            );
            lyr.on('click', () => onSelect({ kind: 'feature', id: source.id }));
          },
      }).addTo(map);
      importedLayers.current.set(layer.id, geo);
    }

    const live = new Set(layers.map((l) => l.id));
    for (const [id, geo] of importedLayers.current) {
      if (!live.has(id)) {
        geo.remove();
        importedLayers.current.delete(id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers, featuresByLayer, categories, hiddenCategoryIds, ready, styleOf]);

  /* --------------------------------------------- drawn features and geofences */

  const buildShape = useCallback(
    (geometry: GeoGeometry | GeofenceGeometry, style: MapStyle): Leaflet.Layer | null => {
      const L = LRef.current;
      const map = mapRef.current;
      if (!L || !map) return null;

      if (geometry.type === 'Circle') {
        const [lng, lat] = geometry.center;
        return L.circle([lat, lng], { radius: geometry.radius, ...pathOptions(style) }).addTo(map);
      }
      if (geometry.type === 'Point') {
        const [lng, lat] = geometry.coordinates;
        return L.marker([lat, lng], {
          icon: L.divIcon({
            html: pinHtml(style.stroke, { icon: 'pin' }),
            className: '',
            iconSize: [30, 40],
            iconAnchor: [15, 40],
          }),
        }).addTo(map);
      }
      if (geometry.type === 'LineString') {
        return L.polyline(toLatLngs(geometry.coordinates), pathOptions(style)).addTo(map);
      }
      if (geometry.type === 'Polygon') {
        return L.polygon(geometry.coordinates.map(toLatLngs), pathOptions(style)).addTo(map);
      }
      return null;
    },
    [],
  );

  /**
   * Leaflet has no built-in vertex editing, so a selected shape grows a draggable
   * handle per vertex — and a circle gets a centre plus one radius handle.
   */
  const attachHandles = useCallback(
    (
      record: OverlayRecord,
      kind: 'feature' | 'geofence',
      id: number,
      geometry: GeoGeometry | GeofenceGeometry,
    ) => {
      const L = LRef.current;
      const map = mapRef.current;
      if (!L || !map) return;

      const handleIcon = L.divIcon({
        html: '<div style="width:11px;height:11px;border-radius:50%;background:#fff;border:2px solid #03458f;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div>',
        className: '',
        iconSize: [11, 11],
        iconAnchor: [5.5, 5.5],
      });

      let timer: ReturnType<typeof setTimeout> | null = null;
      const commit = (next: GeoGeometry | GeofenceGeometry) => {
        editingRef.current = `${kind}:${id}`;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          editingRef.current = null;
          onGeometryEdit(kind, id, next);
        }, 500);
      };

      if (geometry.type === 'Circle') {
        const circle = record.layer as Leaflet.Circle;
        const centre = L.marker(circle.getLatLng(), { icon: handleIcon, draggable: true }).addTo(map);
        const edge = L.marker(circleEast(map, circle), { icon: handleIcon, draggable: true }).addTo(map);

        centre.on('drag', () => {
          circle.setLatLng(centre.getLatLng());
          edge.setLatLng(circleEast(map, circle));
        });
        centre.on('dragend', () =>
          commit({
            type: 'Circle',
            center: [circle.getLatLng().lng, circle.getLatLng().lat],
            radius: circle.getRadius(),
          }),
        );
        edge.on('drag', () => circle.setRadius(circle.getLatLng().distanceTo(edge.getLatLng())));
        edge.on('dragend', () =>
          commit({
            type: 'Circle',
            center: [circle.getLatLng().lng, circle.getLatLng().lat],
            radius: circle.getRadius(),
          }),
        );
        record.handles.push(centre, edge);
        return;
      }

      if (geometry.type === 'Point') {
        const marker = record.layer as Leaflet.Marker;
        marker.options.draggable = true;
        marker.dragging?.enable();
        marker.on('dragend', () => {
          const { lat, lng } = marker.getLatLng();
          commit({ type: 'Point', coordinates: [lng, lat] });
        });
        return;
      }

      const isPolygon = geometry.type === 'Polygon';
      const path = record.layer as Leaflet.Polyline;
      const rings = (isPolygon
        ? (path.getLatLngs() as Leaflet.LatLng[][])
        : [path.getLatLngs() as Leaflet.LatLng[]]) as Leaflet.LatLng[][];

      rings.forEach((ring) => {
        ring.forEach((point, pointIndex) => {
          const handle = L.marker(point, { icon: handleIcon, draggable: true }).addTo(map);
          handle.on('drag', () => {
            ring[pointIndex] = handle.getLatLng();
            path.setLatLngs(isPolygon ? rings : rings[0]);
          });
          handle.on('dragend', () => {
            const next: GeoGeometry = isPolygon
              ? { type: 'Polygon', coordinates: rings.map(ringFromLatLngs) }
              : { type: 'LineString', coordinates: rings[0].map((ll) => [ll.lng, ll.lat] as Position) };
            commit(next);
          });
          record.handles.push(handle);
        });
      });
    },
    [onGeometryEdit],
  );

  const clearRecord = (record: OverlayRecord | undefined) => {
    if (!record) return;
    record.layer.remove();
    for (const handle of record.handles) handle.remove();
  };

  useEffect(() => {
    if (!ready || !LRef.current || !mapRef.current) return;
    const live = new Set<number>();

    for (const layer of layers) {
      if (layer.kind !== 'drawn' || !layer.visible) continue;
      for (const feature of featuresByLayer[layer.id] ?? []) {
        if (isHidden(feature.categoryId)) continue;
        live.add(feature.id);
        if (editingRef.current === `feature:${feature.id}`) continue;

        const selected = selection?.kind === 'feature' && selection.id === feature.id;
        const style = styleOf(layer, feature.style, feature.categoryId);
        const signature = JSON.stringify([feature.geometry, style, selected]);
        const existing = drawnOverlays.current.get(feature.id);
        if (existing?.signature === signature) continue;

        clearRecord(existing);
        const built = buildShape(feature.geometry, style);
        if (!built) continue;
        const record: OverlayRecord = { layer: built, handles: [], signature };
        built.on('click', () => onSelect({ kind: 'feature', id: feature.id }));
        if (selected) attachHandles(record, 'feature', feature.id, feature.geometry);
        drawnOverlays.current.set(feature.id, record);
      }
    }

    for (const [id, record] of drawnOverlays.current) {
      if (!live.has(id)) {
        clearRecord(record);
        drawnOverlays.current.delete(id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers, featuresByLayer, categories, hiddenCategoryIds, selection, ready, styleOf]);

  useEffect(() => {
    if (!ready || !LRef.current || !mapRef.current) return;
    const live = new Set<number>();

    for (const fence of geofences) {
      if (!fence.visible || isHidden(fence.categoryId)) continue;
      live.add(fence.id);
      if (editingRef.current === `geofence:${fence.id}`) continue;

      const selected = selection?.kind === 'geofence' && selection.id === fence.id;
      const occupied = (occupancy[fence.id]?.length ?? 0) > 0;
      const category = fence.categoryId !== null ? categories[fence.categoryId] : undefined;
      const base = category ? { ...fence.style, stroke: category.color, fill: category.color } : fence.style;
      const style: MapStyle = occupied
        ? { ...base, strokeWidth: base.strokeWidth + 1, fillOpacity: Math.min(0.6, base.fillOpacity * 2) }
        : base;

      const signature = JSON.stringify([fence.geometry, style, selected]);
      const existing = geofenceOverlays.current.get(fence.id);
      if (existing?.signature === signature) continue;

      clearRecord(existing);
      const built = buildShape(fence.geometry, style);
      if (!built) continue;
      const record: OverlayRecord = { layer: built, handles: [], signature };
      built.on('click', () => onSelect({ kind: 'geofence', id: fence.id }));
      built.bindTooltip(
        `${esc(fence.name)} — ${occupancy[fence.id]?.length ?? 0} inside`,
        { sticky: true },
      );
      if (selected) attachHandles(record, 'geofence', fence.id, fence.geometry);
      geofenceOverlays.current.set(fence.id, record);
    }

    for (const [id, record] of geofenceOverlays.current) {
      if (!live.has(id)) {
        clearRecord(record);
        geofenceOverlays.current.delete(id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geofences, occupancy, categories, hiddenCategoryIds, selection, ready]);

  /* ---------------------------------------------------------------- drawing */

  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map || !drawMode) return;

    const previewStyle: Leaflet.PathOptions = {
      color: '#03458f',
      weight: 2,
      opacity: 0.9,
      fillColor: '#03458f',
      fillOpacity: 0.15,
      dashArray: '6 4',
    };

    let preview: Leaflet.Polyline | Leaflet.Polygon | Leaflet.Rectangle | Leaflet.Circle | null = null;
    const vertices: Leaflet.LatLng[] = [];
    let anchor: Leaflet.LatLng | null = null;
    let dragging = false;

    const emit = (geometry: GeoGeometry | GeofenceGeometry, shape: 'polygon' | 'circle' | 'rectangle') => {
      const target = geometry.type === 'LineString' ? 'feature' : drawTargetRef.current;
      onDrawComplete({ target, shape, geometry });
    };

    const teardown = () => {
      preview?.remove();
      preview = null;
      map.off('click', onClick);
      map.off('mousemove', onMove);
      map.off('dblclick', onFinish);
      map.off('mousedown', onDown);
      map.off('mouseup', onUp);
      window.removeEventListener('keydown', onKey);
      map.dragging.enable();
      map.doubleClickZoom.enable();
    };

    function redraw(cursor?: Leaflet.LatLng) {
      if (!preview) return;
      const path = cursor ? [...vertices, cursor] : [...vertices];
      (preview as Leaflet.Polyline).setLatLngs(path);
    }

    function onClick(event: Leaflet.LeafletMouseEvent) {
      vertices.push(event.latlng);
      redraw();
    }
    function onMove(event: Leaflet.LeafletMouseEvent) {
      if (drawMode === 'polygon' || drawMode === 'polyline') return redraw(event.latlng);
      if (!dragging || !anchor || !preview) return;
      if (drawMode === 'rectangle') {
        (preview as Leaflet.Rectangle).setBounds(L!.latLngBounds(anchor, event.latlng));
      } else if (drawMode === 'circle') {
        (preview as Leaflet.Circle).setRadius(anchor.distanceTo(event.latlng));
      }
    }
    function onFinish() {
      // A double-click arrives as click, click, dblclick — drop the repeat.
      if (vertices.length >= 2) {
        const last = vertices[vertices.length - 1];
        const previous = vertices[vertices.length - 2];
        if (last.equals(previous, 1e-9)) vertices.pop();
      }
      const coordinates: Position[] = vertices.map((ll) => [ll.lng, ll.lat]);
      if (drawMode === 'polygon') {
        if (coordinates.length < 3) return;
        emit({ type: 'Polygon', coordinates: [[...coordinates, coordinates[0]]] }, 'polygon');
      } else if (coordinates.length >= 2) {
        emit({ type: 'LineString', coordinates }, 'polygon');
      }
    }
    function onDown(event: Leaflet.LeafletMouseEvent) {
      anchor = event.latlng;
      dragging = true;
      preview?.remove();
      preview =
        drawMode === 'rectangle'
          ? L!.rectangle(L!.latLngBounds(anchor, anchor), previewStyle).addTo(map!)
          : L!.circle(anchor, { radius: 0, ...previewStyle }).addTo(map!);
    }
    function onUp(event: Leaflet.LeafletMouseEvent) {
      if (!dragging || !anchor) return;
      dragging = false;
      if (drawMode === 'rectangle') {
        const bounds = L!.latLngBounds(anchor, event.latlng);
        const ne = bounds.getNorthEast();
        const sw = bounds.getSouthWest();
        if (ne.lat === sw.lat || ne.lng === sw.lng) return;
        emit(
          {
            type: 'Polygon',
            coordinates: [
              [
                [sw.lng, sw.lat],
                [ne.lng, sw.lat],
                [ne.lng, ne.lat],
                [sw.lng, ne.lat],
                [sw.lng, sw.lat],
              ],
            ],
          },
          'rectangle',
        );
      } else {
        const radius = anchor.distanceTo(event.latlng);
        if (radius < 1) return;
        emit({ type: 'Circle', center: [anchor.lng, anchor.lat], radius }, 'circle');
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Enter') onFinish();
    }

    if (drawMode === 'place') {
      const onPlace = (event: Leaflet.LeafletMouseEvent) => {
        onDrawComplete({
          target: 'feature',
          shape: 'polygon',
          geometry: { type: 'Point', coordinates: [event.latlng.lng, event.latlng.lat] },
        });
      };
      map.on('click', onPlace);
      return () => {
        map.off('click', onPlace);
      };
    }

    if (drawMode === 'polygon' || drawMode === 'polyline') {
      map.doubleClickZoom.disable();
      preview = drawMode === 'polygon'
        ? L.polygon([], previewStyle).addTo(map)
        : L.polyline([], previewStyle).addTo(map);
      map.on('click', onClick);
      map.on('mousemove', onMove);
      map.on('dblclick', onFinish);
      window.addEventListener('keydown', onKey);
    } else {
      // Panning would fight the drag that sizes the shape.
      map.dragging.disable();
      map.on('mousedown', onDown);
      map.on('mousemove', onMove);
      map.on('mouseup', onUp);
    }

    return teardown;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawMode, ready]);

  /* ------------------------------------------------------------ view control */

  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map || !fitBounds) return;
    const { north, south, east, west } = fitBounds.bounds;
    // Without a ceiling, framing two trackers parked side by side slams the map to
    // maximum zoom, where there is no surrounding detail and it reads as empty.
    map.fitBounds(L.latLngBounds([south, west], [north, east]), {
      padding: [40, 40],
      maxZoom: 16,
    });
  }, [fitBounds, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !focus) return;
    if (focus.kind === 'device') {
      const marker = deviceMarkers.current.get(String(focus.id));
      if (marker) {
        map.setView(marker.getLatLng(), Math.max(15, map.getZoom()));
        marker.openPopup();
      }
    }
  }, [focus, ready]);

  /** Leaflet needs telling when its container changes size. */
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!ready || !wrapper || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => mapRef.current?.invalidateSize());
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [ready]);

  const toggleFullscreen = () => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void wrapper.requestFullscreen?.();
  };

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-gray-50 p-6">
        <div className="max-w-md rounded-2xl border border-amber-100 bg-amber-50 p-5 text-sm text-amber-900">
          <p className="font-semibold">The map can&apos;t load</p>
          <p className="mt-1.5 leading-relaxed">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={wrapperRef} className="relative h-full w-full bg-gray-100">
      <div ref={divRef} className="absolute inset-0" />
      {children}
      <button
        type="button"
        onClick={toggleFullscreen}
        className="absolute right-2.5 top-2.5 z-[1000] rounded-lg bg-white p-2 text-gray-600 shadow-md transition hover:bg-gray-50"
        aria-label="Toggle fullscreen"
        title="Fullscreen"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4" />
        </svg>
      </button>
    </div>
  );
}

/** Where to park a circle's radius handle: due east of its centre, on the rim. */
function circleEast(map: Leaflet.Map, circle: Leaflet.Circle): Leaflet.LatLng {
  const centre = circle.getLatLng();
  return map.layerPointToLatLng(
    map.latLngToLayerPoint([centre.lat, circle.getBounds().getEast()]),
  );
}
