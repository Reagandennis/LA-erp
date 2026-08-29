'use client';

import { useEffect, useRef, useState } from 'react';

import { MAPS_API_KEY, MAPS_MAP_ID, loadGoogleMaps, onMapsAuthFailure } from '@/lib/google-maps';

export interface MapDevice {
  from: string;
  lat: number;
  lon: number;
  accuracy?: number;
  at: number;
  address?: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

/** Live device-tracking map fed by Zello location reports. */
export default function ZelloMap({
  devices,
  focus,
  fitNonce,
}: {
  devices: MapDevice[];
  /** Pan/zoom to this device and open its popup; bump `n` to re-trigger for the same device. */
  focus?: { from: string; n: number } | null;
  /** Bump this to re-frame the map around all current devices. */
  fitNonce?: number;
}) {
  const key = MAPS_API_KEY;
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<Map<string, any>>(new Map());
  const fittedRef = useRef(false);
  const devicesRef = useRef<MapDevice[]>(devices);
  devicesRef.current = devices;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!key) {
      setError(true);
      return;
    }
    let cancelled = false;
    // Google refuses a bad key only through this hook, long after the script loads.
    const unsubscribe = onMapsAuthFailure(() => {
      if (!cancelled) setError(true);
    });
    loadGoogleMaps(key)
      .then(() => {
        if (cancelled || !divRef.current) return;
        const g = (window as any).google;
        mapRef.current = new g.maps.Map(divRef.current, {
          center: { lat: -1.2921, lng: 36.8219 }, // Nairobi
          zoom: 6,
          mapId: MAPS_MAP_ID,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          clickableIcons: false,
        });
        setReady(true);
      })
      .catch(() => setError(true));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [key]);

  useEffect(() => {
    if (!ready) return;
    const g = (window as any).google;
    const map = mapRef.current;
    if (!g || !map) return;
    const markers = markersRef.current;
    const seen = new Set<string>();
    const bounds = new g.maps.LatLngBounds();

    devices.forEach((d, i) => {
      seen.add(d.from);
      const pos = { lat: d.lat, lng: d.lon };
      // Numbered, brand-coloured pin keeps each marker correlated with its list row.
      const pin = new g.maps.marker.PinElement({
        glyph: String(i + 1),
        glyphColor: '#ffffff',
        background: '#03458f',
        borderColor: '#022f63',
      });
      const content =
        `<div style="font:13px system-ui;min-width:130px">` +
        `<strong>${esc(d.from)}</strong><br/>` +
        `<span style="color:#6b7280">${esc(new Date(d.at).toLocaleString())}</span>` +
        (d.address ? `<br/>${esc(d.address)}` : '') +
        (d.accuracy ? `<br/><span style="color:#9ca3af">±${Math.round(d.accuracy)} m</span>` : '') +
        `</div>`;
      let m = markers.get(d.from);
      if (!m) {
        m = new g.maps.marker.AdvancedMarkerElement({
          map,
          position: pos,
          title: d.from,
          content: pin,
          gmpClickable: true,
        });
        m.__info = new g.maps.InfoWindow({ content });
        m.addListener('gmp-click', () => m.__info.open({ anchor: m, map }));
        markers.set(d.from, m);
      } else {
        m.position = pos;
        m.content = pin;
        m.__info?.setContent(content);
      }
      bounds.extend(pos);
    });
    for (const [k, m] of markers) {
      if (!seen.has(k)) {
        m.map = null;
        markers.delete(k);
      }
    }
    // Auto-frame once; afterwards leave the user's pan/zoom alone.
    if (!fittedRef.current && devices.length > 0) {
      if (devices.length === 1) {
        map.setCenter({ lat: devices[0].lat, lng: devices[0].lon });
        map.setZoom(14);
      } else {
        map.fitBounds(bounds);
      }
      fittedRef.current = true;
    }
  }, [devices, ready]);

  // Pan/zoom to a chosen device and open its popup (triggered from the device list).
  useEffect(() => {
    if (!ready || !focus) return;
    const m = markersRef.current.get(focus.from);
    const map = mapRef.current;
    if (m && map) {
      if (m.position) map.panTo(m.position);
      map.setZoom(15);
      m.__info?.open({ anchor: m, map });
    }
  }, [focus, ready]);

  // Re-frame around all current devices on demand ("Fit all").
  useEffect(() => {
    if (!ready || !fitNonce) return;
    const g = (window as any).google;
    const map = mapRef.current;
    if (!g || !map) return;
    const list = devicesRef.current;
    if (list.length === 0) return;
    if (list.length === 1) {
      map.setCenter({ lat: list[0].lat, lng: list[0].lon });
      map.setZoom(14);
      return;
    }
    const bounds = new g.maps.LatLngBounds();
    for (const d of list) bounds.extend({ lat: d.lat, lng: d.lon });
    map.fitBounds(bounds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitNonce, ready]);

  if (!key || error) {
    return (
      <div className="flex h-80 items-center justify-center rounded-2xl border border-gray-100 bg-gray-50 px-6 text-center text-sm text-gray-400">
        {key
          ? 'Map could not load — Google rejected the Maps API key, or the Maps JavaScript API is not enabled for it.'
          : 'Map unavailable — set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY in .env.'}
      </div>
    );
  }
  return <div ref={divRef} className="h-80 w-full rounded-2xl" />;
}
