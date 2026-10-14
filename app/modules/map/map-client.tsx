'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { boundsOf, isInsideGeofence, type GeoGeometry, type GeofenceGeometry, type LatLngBounds } from '@/lib/geo-geometry';
import { startVisibleInterval } from '@/lib/visible-interval';
import {
  DEFAULT_STYLE,
  type MapCategoryDto,
  type MapDeviceTagDto,
  type MapFeatureDto,
  type MapGeofenceDto,
  type MapLayerDto,
  type MapStyle,
  type MapWorkspaceDto,
  type TrackedDevice,
} from '@/lib/map-types';
import { SILENT_BANNER_HEADER, useBanner } from '@/app/ui/banner';

import MapCanvas from './map-canvas';
import BordersPanel from './panel-borders';
import CategoriesPanel, { type CategoryDraft } from './panel-categories';
import DevicesPanel from './panel-devices';
import GeofencesPanel from './panel-geofences';
import LayersPanel from './panel-layers';
import { filterDevices } from './device-search';
import { timeAgo } from './map-format';
import { OVERLAYS } from './basemaps';
import { BASEMAPS, type Basemap, type DrawMode, type DrawTarget, type DrawnShape, type MapFocus, type OverlayToggles, type PanelTab, type Selection } from './types';

interface SourceStatus {
  configured: boolean;
  count: number;
  error: string | null;
}

interface DevicesResponse {
  devices: TrackedDevice[];
  sources: Record<'traccar' | 'zello', SourceStatus>;
}

const TABS: Array<{ value: PanelTab; label: string }> = [
  { value: 'devices', label: 'Devices' },
  { value: 'layers', label: 'Layers' },
  { value: 'geofences', label: 'Zones' },
  { value: 'categories', label: 'Categories' },
  { value: 'borders', label: 'Borders' },
];

const DRAW_TOOLS: Array<{ value: DrawMode; label: string; path: string }> = [
  { value: 'place', label: 'Drop a pin', path: 'M12 2a7 7 0 00-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 00-7-7zm0 9.5A2.5 2.5 0 1112 6.5a2.5 2.5 0 010 5z' },
  { value: 'polyline', label: 'Draw a line', path: 'M4 20L20 4M4 20h5m11-16v5' },
  { value: 'polygon', label: 'Draw a polygon', path: 'M12 3l8 6-3 10H7L4 9l8-6z' },
  { value: 'rectangle', label: 'Draw a rectangle', path: 'M4 6h16v12H4z' },
  { value: 'circle', label: 'Draw a circle', path: 'M12 4a8 8 0 100 16 8 8 0 000-16z' },
];

/** Mutations that fire on every drag or toggle shouldn't raise a banner each time. */
const QUIET = { [SILENT_BANNER_HEADER]: '1', 'Content-Type': 'application/json' };
const LOUD = { 'Content-Type': 'application/json' };

export default function MapClient() {
  const banner = useBanner();

  const [devices, setDevices] = useState<TrackedDevice[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const [workspace, setWorkspace] = useState<MapWorkspaceDto>({
    categories: [],
    layers: [],
    geofences: [],
    deviceTags: [],
  });
  const [featuresByLayer, setFeaturesByLayer] = useState<Record<number, MapFeatureDto[]>>({});
  const [hiddenCategoryIds, setHiddenCategoryIds] = useState<number[]>([]);

  const [basemap, setBasemap] = useState<Basemap>('streets');
  const [overlays, setOverlays] = useState<OverlayToggles>({ cycling: false, transit: false });
  const [drawMode, setDrawMode] = useState<DrawMode | null>(null);
  const [drawTarget, setDrawTarget] = useState<DrawTarget>('feature');
  const [activeLayerId, setActiveLayerId] = useState<number | null>(null);

  const [selection, setSelection] = useState<Selection | null>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [fitBounds, setFitBounds] = useState<{ bounds: LatLngBounds; n: number } | null>(null);

  const [panelOpen, setPanelOpen] = useState(true);
  const [tab, setTab] = useState<PanelTab>('devices');
  const [deviceQuery, setDeviceQuery] = useState('');
  const [importing, setImporting] = useState(false);

  const requestedLayers = useRef<Set<number>>(new Set());

  /* ------------------------------------------------------------- live devices */

  const loadDevices = useCallback(async () => {
    try {
      const res = await fetch('/api/map/devices', { credentials: 'include' });
      if (!res.ok) throw new Error('unreachable');
      const data = (await res.json()) as DevicesResponse;
      setDevices(data.devices);

      // Report a source that is configured but failing; stay quiet about one that
      // was simply never set up, and about all of them once positions are flowing.
      const broken = Object.entries(data.sources)
        .filter(([, status]) => status.configured && status.error)
        .map(([name, status]) => `${name}: ${status.error}`);
      const anyConfigured = Object.values(data.sources).some((status) => status.configured);
      setNotice(
        broken.length > 0
          ? broken.join(' · ')
          : anyConfigured
            ? null
            : 'No tracking source is configured. Set TRACCAR_URL and TRACCAR_TOKEN, or the ZELLO_* variables.',
      );
      setUpdatedAt(Date.now());
      setNow(Date.now());
    } catch {
      setNotice('Could not reach the location service.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(
    () => startVisibleInterval(() => void loadDevices(), 30_000, { immediate: true }),
    [loadDevices],
  );

  /* ---------------------------------------------------------------- workspace */

  const loadWorkspace = useCallback(async () => {
    const res = await fetch('/api/map/workspace', { credentials: 'include' });
    if (!res.ok) return;
    const data = (await res.json()) as MapWorkspaceDto;
    setWorkspace(data);
    setActiveLayerId((current) => current ?? data.layers.find((l) => l.kind === 'drawn')?.id ?? null);
  }, []);

  useEffect(() => {
    void (async () => {
      await loadWorkspace();
    })();
  }, [loadWorkspace]);

  /** Features load per layer, the first time that layer is shown. */
  useEffect(() => {
    for (const layer of workspace.layers) {
      if (layer.kind === 'boundary' || !layer.visible) continue;
      if (requestedLayers.current.has(layer.id)) continue;
      requestedLayers.current.add(layer.id);
      void fetch(`/api/map/layers/${layer.id}/features`, { credentials: 'include' })
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { items: MapFeatureDto[] } | null) => {
          if (data) setFeaturesByLayer((prev) => ({ ...prev, [layer.id]: data.items }));
        });
    }
  }, [workspace.layers]);

  const refreshLayerFeatures = useCallback(async (layerId: number) => {
    const res = await fetch(`/api/map/layers/${layerId}/features`, { credentials: 'include' });
    if (!res.ok) return;
    const data = (await res.json()) as { items: MapFeatureDto[] };
    setFeaturesByLayer((prev) => ({ ...prev, [layerId]: data.items }));
  }, []);

  /* --------------------------------------------------------- derived lookups */

  const sortedDevices = useMemo(
    () => [...devices].sort((a, b) => a.name.localeCompare(b.name)),
    [devices],
  );

  const categoriesById = useMemo(() => {
    const map: Record<number, MapCategoryDto> = {};
    for (const category of workspace.categories) map[category.id] = category;
    return map;
  }, [workspace.categories]);

  const deviceTagsByName = useMemo(() => {
    const map: Record<string, MapDeviceTagDto> = {};
    for (const tag of workspace.deviceTags) map[tag.device] = tag;
    return map;
  }, [workspace.deviceTags]);

  const deviceLabels = useMemo(() => {
    const map: Record<string, string> = {};
    for (const device of sortedDevices) map[device.key] = deviceTagsByName[device.key]?.label || device.name;
    return map;
  }, [sortedDevices, deviceTagsByName]);

  /** Which devices sit inside each zone right now — recomputed on every poll. */
  const occupancy = useMemo(() => {
    const result: Record<number, string[]> = {};
    for (const fence of workspace.geofences) {
      result[fence.id] = sortedDevices
        .filter((device) => isInsideGeofence(fence.geometry, { lat: device.lat, lng: device.lon }))
        .map((device) => device.key);
    }
    return result;
  }, [workspace.geofences, sortedDevices]);

  const visibleDevices = useMemo(
    () =>
      filterDevices(
        sortedDevices,
        deviceQuery,
        categoriesById,
        (device) => deviceTagsByName[device.key]?.categoryId ?? null,
      ),
    [sortedDevices, deviceQuery, categoriesById, deviceTagsByName],
  );

  const liveCount = sortedDevices.filter((d) => now - d.at <= 5 * 60_000).length;
  const insideCount = Object.values(occupancy).reduce((total, list) => total + list.length, 0);

  /* ---------------------------------------------------------------- mutations */

  const fail = useCallback(
    async (res: Response, fallback: string) => {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      banner.error(data?.error ?? fallback);
    },
    [banner],
  );

  const saveCategory = useCallback(
    async (draft: CategoryDraft) => {
      const body = JSON.stringify({ name: draft.name, color: draft.color, icon: draft.icon, scope: draft.scope });
      const res = draft.id
        ? await fetch(`/api/map/categories/${draft.id}`, { method: 'PATCH', credentials: 'include', headers: LOUD, body })
        : await fetch('/api/map/categories', { method: 'POST', credentials: 'include', headers: LOUD, body });
      if (!res.ok) return fail(res, 'Could not save the category');
      await loadWorkspace();
    },
    [fail, loadWorkspace],
  );

  const deleteCategory = useCallback(
    async (id: number) => {
      const res = await fetch(`/api/map/categories/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) return fail(res, 'Could not delete the category');
      await loadWorkspace();
    },
    [fail, loadWorkspace],
  );

  const patchLayer = useCallback(
    async (layer: MapLayerDto, patch: Record<string, unknown>) => {
      setWorkspace((prev) => ({
        ...prev,
        layers: prev.layers.map((l) => (l.id === layer.id ? { ...l, ...patch } : l)),
      }));
      const res = await fetch(`/api/map/layers/${layer.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: QUIET,
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        await fail(res, 'Could not update the layer');
        await loadWorkspace();
      }
    },
    [fail, loadWorkspace],
  );

  const createLayer = useCallback(
    async (name: string) => {
      const res = await fetch('/api/map/layers', {
        method: 'POST',
        credentials: 'include',
        headers: LOUD,
        body: JSON.stringify({ name }),
      });
      if (!res.ok) return fail(res, 'Could not create the layer');
      const { item } = (await res.json()) as { item: MapLayerDto };
      setActiveLayerId(item.id);
      await loadWorkspace();
    },
    [fail, loadWorkspace],
  );

  const deleteLayer = useCallback(
    async (layer: MapLayerDto) => {
      const res = await fetch(`/api/map/layers/${layer.id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) return fail(res, 'Could not delete the layer');
      requestedLayers.current.delete(layer.id);
      setFeaturesByLayer((prev) => {
        const next = { ...prev };
        delete next[layer.id];
        return next;
      });
      setActiveLayerId((current) => (current === layer.id ? null : current));
      await loadWorkspace();
    },
    [fail, loadWorkspace],
  );

  const importFile = useCallback(
    async (file: File, categoryId: number | null) => {
      setImporting(true);
      try {
        const form = new FormData();
        form.append('file', file);
        if (categoryId) form.append('categoryId', String(categoryId));
        const res = await fetch('/api/map/import', { method: 'POST', credentials: 'include', body: form });
        const data = (await res.json().catch(() => null)) as
          | { layer?: MapLayerDto; imported?: number; skipped?: number; warnings?: string[]; error?: string }
          | null;
        if (!res.ok) {
          banner.error(data?.error ?? 'Could not import that file');
          return;
        }
        banner.success(
          `Imported ${data?.imported ?? 0} feature${data?.imported === 1 ? '' : 's'} from ${file.name}`,
          [data?.skipped ? `${data.skipped} row(s) skipped.` : '', ...(data?.warnings ?? [])]
            .filter(Boolean)
            .join(' ') || undefined,
        );
        await loadWorkspace();
        if (data?.layer) await refreshLayerFeatures(data.layer.id);
        if (data?.layer?.bounds) setFitBounds({ bounds: data.layer.bounds, n: Date.now() });
      } finally {
        setImporting(false);
      }
    },
    [banner, loadWorkspace, refreshLayerFeatures],
  );

  const patchGeofence = useCallback(
    async (fence: MapGeofenceDto, patch: Record<string, unknown>) => {
      setWorkspace((prev) => ({
        ...prev,
        geofences: prev.geofences.map((f) => (f.id === fence.id ? { ...f, ...patch } : f)),
      }));
      const res = await fetch(`/api/map/geofences/${fence.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: QUIET,
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        await fail(res, 'Could not update the zone');
        await loadWorkspace();
      }
    },
    [fail, loadWorkspace],
  );

  const deleteGeofence = useCallback(
    async (fence: MapGeofenceDto) => {
      const res = await fetch(`/api/map/geofences/${fence.id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) return fail(res, 'Could not delete the zone');
      await loadWorkspace();
    },
    [fail, loadWorkspace],
  );

  const assignDevice = useCallback(
    async (device: string, categoryId: number | null) => {
      setWorkspace((prev) => {
        const existing = prev.deviceTags.find((t) => t.device === device);
        const next: MapDeviceTagDto = { device, categoryId, icon: existing?.icon ?? null, label: existing?.label ?? null };
        return {
          ...prev,
          deviceTags: existing
            ? prev.deviceTags.map((t) => (t.device === device ? next : t))
            : [...prev.deviceTags, next],
        };
      });
      const res = await fetch('/api/map/device-tags', {
        method: 'PUT',
        credentials: 'include',
        headers: QUIET,
        body: JSON.stringify({ device, categoryId }),
      });
      if (!res.ok) {
        await fail(res, 'Could not tag the device');
        await loadWorkspace();
      }
    },
    [fail, loadWorkspace],
  );

  /* ------------------------------------------------------------------ drawing */

  /** Drawn shapes need somewhere to live; make one silently the first time. */
  const ensureDrawingLayer = useCallback(async (): Promise<number | null> => {
    if (activeLayerId) return activeLayerId;
    const existing = workspace.layers.find((l) => l.kind === 'drawn');
    if (existing) {
      setActiveLayerId(existing.id);
      return existing.id;
    }
    const res = await fetch('/api/map/layers', {
      method: 'POST',
      credentials: 'include',
      headers: QUIET,
      body: JSON.stringify({ name: 'Drawings' }),
    });
    if (!res.ok) {
      await fail(res, 'Could not create a layer to draw on');
      return null;
    }
    const { item } = (await res.json()) as { item: MapLayerDto };
    setActiveLayerId(item.id);
    await loadWorkspace();
    return item.id;
  }, [activeLayerId, fail, loadWorkspace, workspace.layers]);

  const handleDrawComplete = useCallback(
    async (shape: DrawnShape) => {
      setDrawMode(null);

      if (shape.target === 'geofence') {
        const res = await fetch('/api/map/geofences', {
          method: 'POST',
          credentials: 'include',
          headers: LOUD,
          body: JSON.stringify({
            name: `Zone ${workspace.geofences.length + 1}`,
            shape: shape.shape,
            geometry: shape.geometry,
            style: DEFAULT_STYLE,
          }),
        });
        if (!res.ok) return fail(res, 'Could not save the zone');
        const { item } = (await res.json()) as { item: MapGeofenceDto };
        await loadWorkspace();
        setTab('geofences');
        setSelection({ kind: 'geofence', id: item.id });
        return;
      }

      const layerId = await ensureDrawingLayer();
      if (!layerId) return;
      const res = await fetch(`/api/map/layers/${layerId}/features`, {
        method: 'POST',
        credentials: 'include',
        headers: LOUD,
        body: JSON.stringify({ name: '', geometry: shape.geometry }),
      });
      if (!res.ok) return fail(res, 'Could not save the shape');
      const { item } = (await res.json()) as { item: MapFeatureDto };
      await refreshLayerFeatures(layerId);
      await loadWorkspace();
      setSelection({ kind: 'feature', id: item.id });
    },
    [ensureDrawingLayer, fail, loadWorkspace, refreshLayerFeatures, workspace.geofences.length],
  );

  const handleGeometryEdit = useCallback(
    async (kind: 'feature' | 'geofence', id: number, geometry: GeoGeometry | GeofenceGeometry) => {
      const url = kind === 'feature' ? `/api/map/features/${id}` : `/api/map/geofences/${id}`;
      const res = await fetch(url, {
        method: 'PATCH',
        credentials: 'include',
        headers: QUIET,
        body: JSON.stringify({ geometry }),
      });
      if (!res.ok) return fail(res, 'Could not save the new shape');
      if (kind === 'geofence') {
        setWorkspace((prev) => ({
          ...prev,
          geofences: prev.geofences.map((f) =>
            f.id === id ? { ...f, geometry: geometry as GeofenceGeometry } : f,
          ),
        }));
      } else {
        setFeaturesByLayer((prev) => {
          const next = { ...prev };
          for (const [layerId, features] of Object.entries(next)) {
            next[Number(layerId)] = features.map((f) =>
              f.id === id ? { ...f, geometry: geometry as GeoGeometry } : f,
            );
          }
          return next;
        });
      }
    },
    [fail],
  );

  /* --------------------------------------------------------------- view helpers */

  const zoomToLayer = useCallback(
    (layer: MapLayerDto) => {
      const loaded = featuresByLayer[layer.id];
      const bounds = loaded?.length ? boundsOf(loaded.map((f) => f.geometry)) : layer.bounds;
      if (bounds) setFitBounds({ bounds, n: Date.now() });
    },
    [featuresByLayer],
  );

  /** Every geometry currently on the map, for framing the whole picture. */
  const allGeometries = useMemo(
    () => [
      ...sortedDevices.map(
        (d) => ({ type: 'Point', coordinates: [d.lon, d.lat] }) as GeoGeometry,
      ),
      ...Object.values(featuresByLayer).flat().map((f) => f.geometry),
      ...workspace.geofences.map((f) => f.geometry),
    ],
    [sortedDevices, featuresByLayer, workspace.geofences],
  );

  const fitAll = useCallback(() => {
    const bounds = boundsOf(allGeometries);
    if (bounds) setFitBounds({ bounds, n: Date.now() });
  }, [allGeometries]);

  /*
   * Follow the search. Filtering the markers without moving the map would show
   * an empty view whenever the match sits outside the current viewport — search
   * for a Ghana tracker while looking at Nairobi and the map would look broken.
   * Only re-frames when the query itself changes, so it never fights a manual pan.
   */
  const [fittedQuery, setFittedQuery] = useState('');
  const trimmedQuery = deviceQuery.trim();
  if (trimmedQuery !== fittedQuery) {
    setFittedQuery(trimmedQuery);
    if (trimmedQuery && visibleDevices.length > 0) {
      const bounds = boundsOf(
        visibleDevices.map((d) => ({ type: 'Point', coordinates: [d.lon, d.lat] }) as GeoGeometry),
      );
      if (bounds) setFitBounds((current) => ({ bounds, n: (current?.n ?? 0) + 1 }));
    }
  }

  // Frame the saved content on first load. Without this the map opens at its
  // default continental zoom even when everything sits in one city.
  const autoFittedRef = useRef(false);
  useEffect(() => {
    if (autoFittedRef.current || allGeometries.length === 0) return;
    autoFittedRef.current = true;
    fitAll();
  }, [allGeometries, fitAll]);

  const zoomToGeofence = useCallback((fence: MapGeofenceDto) => {
    const bounds = boundsOf([fence.geometry]);
    if (bounds) setFitBounds({ bounds, n: Date.now() });
  }, []);

  const focusDevice = useCallback((device: string) => {
    setFocus((prev) => ({ kind: 'device', id: device, n: (prev?.n ?? 0) + 1 }));
    setSelection({ kind: 'device', id: device });
  }, []);

  const toggleHidden = useCallback((id: number) => {
    setHiddenCategoryIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  // Escape backs out of a drawing mode without leaving a half-drawn shape behind.
  useEffect(() => {
    if (!drawMode) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawMode(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawMode]);

  /* ---------------------------------------------------------------- rendering */

  const startTool = (tool: DrawMode, target: DrawTarget) => {
    setDrawTarget(target);
    setDrawMode((current) => (current === tool && drawTarget === target ? null : tool));
  };

  return (
    <main className="flex h-[calc(100dvh-3rem)] flex-col bg-gray-50/50">
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-gray-100 bg-white px-4 py-2.5 sm:px-6">
        <div className="min-w-0">
          <h1 className="text-lg font-bold tracking-tight text-primary sm:text-xl">Map</h1>
          <p className="text-xs text-gray-500">Live device positions, saved places and zones.</p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
          <Chip label="Devices" value={sortedDevices.length} />
          <Chip label="Live" value={liveCount} accent="text-emerald-600" />
          <Chip label="Zones" value={workspace.geofences.length} />
          <Chip label="In a zone" value={insideCount} />
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {updatedAt && <span className="hidden text-xs text-gray-400 sm:inline">Updated {timeAgo(updatedAt, now)}</span>}
          <button
            type="button"
            onClick={fitAll}
            disabled={allGeometries.length === 0}
            className="rounded-xl bg-gray-50 px-3.5 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-40"
          >
            Fit all
          </button>
          <button
            type="button"
            onClick={() => void loadDevices()}
            className="rounded-xl bg-primary px-3.5 py-2 text-sm font-semibold text-white transition hover:opacity-90"
          >
            Refresh
          </button>
        </div>
      </header>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-gray-100 bg-white px-4 py-2 sm:px-6">
        <button
          type="button"
          onClick={() => setPanelOpen((open) => !open)}
          className="rounded-lg p-1.5 text-gray-500 transition hover:bg-gray-100"
          aria-label={panelOpen ? 'Hide the side panel' : 'Show the side panel'}
          title={panelOpen ? 'Hide panel' : 'Show panel'}
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 5h16v14H4zM10 5v14" />
          </svg>
        </button>

        <nav className="flex items-center gap-1 rounded-xl bg-gray-50 p-1">
          {BASEMAPS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setBasemap(value)}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-40 ${
                basemap === value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-1 rounded-xl bg-gray-50 p-1">
          {OVERLAYS.map(({ value: key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setOverlays((prev) => ({ ...prev, [key]: !prev[key] }))}
              aria-pressed={overlays[key]}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                overlays[key] ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 rounded-xl bg-gray-50 p-1">
          {DRAW_TOOLS.map((tool) => {
            const on = drawMode === tool.value && drawTarget === 'feature';
            return (
              <button
                key={tool.value}
                type="button"
                  onClick={() => startTool(tool.value, 'feature')}
                aria-pressed={on}
                title={tool.label}
                aria-label={tool.label}
                className={`rounded-lg p-1.5 transition disabled:opacity-40 ${
                  on ? 'bg-white text-primary shadow-sm' : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d={tool.path} />
                </svg>
              </button>
            );
          })}
        </div>

        {drawMode && (
          <span className="text-xs font-medium text-primary">
            {drawMode === 'place'
              ? 'Click the map to drop a pin'
              : drawMode === 'polygon' || drawMode === 'polyline'
                ? `Click to add points, double-click to finish ${drawTarget === 'geofence' ? 'the zone' : ''}`.trim()
                : 'Drag on the map to size the shape'}{' '}
            — Esc to cancel
          </span>
        )}
      </div>

      {notice && (
        <div className="shrink-0 border-b border-amber-100 bg-amber-50 px-4 py-2 text-sm text-amber-800 sm:px-6">
          {notice}
        </div>
      )}

      <div className="relative flex min-h-0 flex-1">
        {/*
          Below md the panel overlays the map instead of sitting beside it: at
          `w-full` in the flex row it starved the map of every pixel, leaving a
          zero-width canvas with no way to reach it. The toolbar toggle switches
          between the two on a phone, and nothing changes from md up.
        */}
        <aside
          className={`${panelOpen ? 'flex' : 'hidden'} absolute inset-y-0 left-0 z-20 w-full min-h-0 shrink-0 flex-col border-r border-gray-100 bg-white md:relative md:inset-auto md:z-auto md:w-80 lg:w-96`}
        >
          <nav className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-gray-100 p-2 scrollbar-hide">
            {TABS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setTab(value)}
                className={`whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                  tab === value ? 'bg-primary text-white' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>

          <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
            {tab === 'devices' && (
              <DevicesPanel
                devices={visibleDevices}
                query={deviceQuery}
                onQueryChange={setDeviceQuery}
                total={sortedDevices.length}
                deviceTags={deviceTagsByName}
                categories={workspace.categories}
                now={now}
                loading={loading}
                onFocus={focusDevice}
                onAssign={(device, categoryId) => void assignDevice(device, categoryId)}
              />
            )}
            {tab === 'layers' && (
              <LayersPanel
                layers={workspace.layers}
                categories={workspace.categories}
                activeLayerId={activeLayerId}
                importing={importing}
                onSetActive={setActiveLayerId}
                onToggleVisible={(layer) => void patchLayer(layer, { visible: !layer.visible })}
                onRename={(layer, name) => void patchLayer(layer, { name })}
                onRestyle={(layer, style: MapStyle) => void patchLayer(layer, { style })}
                onDelete={(layer) => void deleteLayer(layer)}
                onFit={zoomToLayer}
                onCreate={(name) => void createLayer(name)}
                onImport={(file, categoryId) => void importFile(file, categoryId)}
              />
            )}
            {tab === 'geofences' && (
              <GeofencesPanel
                geofences={workspace.geofences}
                categories={workspace.categories}
                occupancy={occupancy}
                deviceLabels={deviceLabels}
                drawing={drawMode !== null && drawTarget === 'geofence'}
                canDraw
                onStartDraw={() => startTool('polygon', 'geofence')}
                onToggleVisible={(fence) => void patchGeofence(fence, { visible: !fence.visible })}
                onRename={(fence, name) => void patchGeofence(fence, { name })}
                onRestyle={(fence, style) => void patchGeofence(fence, { style })}
                onSetCategory={(fence, categoryId) => void patchGeofence(fence, { categoryId })}
                onDelete={(fence) => void deleteGeofence(fence)}
                onFocusDevice={focusDevice}
                onZoomTo={zoomToGeofence}
              />
            )}
            {tab === 'categories' && (
              <CategoriesPanel
                categories={workspace.categories}
                hiddenCategoryIds={hiddenCategoryIds}
                onToggleHidden={toggleHidden}
                onSave={saveCategory}
                onDelete={deleteCategory}
              />
            )}
            {tab === 'borders' && (
              <BordersPanel
                layers={workspace.layers}
                onToggleVisible={(layer) => void patchLayer(layer, { visible: !layer.visible })}
                onRestyle={(layer, style) => void patchLayer(layer, { style })}
              />
            )}
          </div>
        </aside>

        <section className="relative min-h-0 min-w-0 flex-1">
          <MapCanvas
            devices={visibleDevices}
            deviceTags={deviceTagsByName}
            categories={categoriesById}
            hiddenCategoryIds={hiddenCategoryIds}
            layers={workspace.layers}
            featuresByLayer={featuresByLayer}
            geofences={workspace.geofences}
            occupancy={occupancy}
            basemap={basemap}
            overlays={overlays}
            drawMode={drawMode}
            drawTarget={drawTarget}
            selection={selection}
            focus={focus}
            fitBounds={fitBounds}
            onDrawComplete={(shape) => void handleDrawComplete(shape)}
            onSelect={setSelection}
            onGeometryEdit={(kind, id, geometry) => void handleGeometryEdit(kind, id, geometry)}
          />
        </section>
      </div>
    </main>
  );
}

function Chip({ label, value, accent = 'text-gray-900' }: Readonly<{ label: string; value: number; accent?: string }>) {
  return (
    <span className="inline-flex items-center gap-1 rounded-lg bg-gray-50 px-2 py-1">
      <span className="text-gray-400">{label}</span>
      <span className={`font-semibold tabular-nums ${accent}`}>{value}</span>
    </span>
  );
}
