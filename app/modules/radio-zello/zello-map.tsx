'use client';

import { useEffect, useRef, useState } from 'react';

export interface MapDevice {
  from: string;
  lat: number;
  lon: number;
  accuracy?: number;
  at: number;
  address?: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

let mapsPromise: Promise<void> | null = null;
function loadGoogleMaps(key: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no-window'));
  if ((window as any).google?.maps) return Promise.resolve();
  if (mapsPromise) return mapsPromise;
  mapsPromise = new Promise<void>((resolve, reject) => {
    // Use the documented callback param — it fires only once google.maps (incl. Map)
    // is fully ready. Relying on script onload races the async library load and throws.
    const cb = '__zelloGmapsReady';
    const timer = setTimeout(() => reject(new Error('maps-timeout')), 12000);
    (window as any)[cb] = () => {
      clearTimeout(timer);
      resolve();
    };
    const s = document.createElement('script');
    // `marker` library is required for AdvancedMarkerElement.
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=marker&v=weekly&callback=${cb}`;
    s.async = true;
    s.onerror = () => {
      clearTimeout(timer);
      reject(new Error('maps-failed'));
    };
    document.head.appendChild(s);
  });
  return mapsPromise;
}

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
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
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
    loadGoogleMaps(key)
      .then(() => {
        if (cancelled || !divRef.current) return;
        const g = (window as any).google;
        // AdvancedMarkerElement requires a Map ID. Use a configured one in
        // production; fall back to Google's DEMO_MAP_ID for local/dev.
        const mapId = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || 'DEMO_MAP_ID';
        mapRef.current = new g.maps.Map(divRef.current, {
          center: { lat: 1.2921, lng: 36.8219 }, // Nairobi
          zoom: 6,
          mapId,
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
          content: pin.element,
          gmpClickable: true,
        });
        m.__info = new g.maps.InfoWindow({ content });
        m.addListener('gmp-click', () => m.__info.open({ anchor: m, map }));
        markers.set(d.from, m);
      } else {
        m.position = pos;
        m.content = pin.element;
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
          ? 'Map could not load — make sure the Google Maps JavaScript API is enabled and this origin is allowed on the key.'
          : 'Map unavailable — set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY in .env.'}
      </div>
    );
  }
  return <div ref={divRef} className="h-80 w-full rounded-2xl" />;
}
