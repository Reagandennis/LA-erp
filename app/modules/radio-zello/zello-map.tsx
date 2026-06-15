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
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=${cb}`;
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

/** Live device-tracking map fed by Zello `on_location` reports. */
export default function ZelloMap({ devices }: { devices: MapDevice[] }) {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<Map<string, any>>(new Map());
  const fittedRef = useRef(false);
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
        mapRef.current = new g.maps.Map(divRef.current, {
          center: { lat: 1.2921, lng: 36.8219 }, // Nairobi
          zoom: 6,
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

    for (const d of devices) {
      seen.add(d.from);
      const pos = { lat: d.lat, lng: d.lon };
      const content =
        `<div style="font:13px system-ui;min-width:130px">` +
        `<strong>${esc(d.from)}</strong><br/>` +
        `<span style="color:#6b7280">${esc(new Date(d.at).toLocaleString())}</span>` +
        (d.address ? `<br/>${esc(d.address)}` : '') +
        (d.accuracy ? `<br/><span style="color:#9ca3af">±${Math.round(d.accuracy)} m</span>` : '') +
        `</div>`;
      let m = markers.get(d.from);
      if (!m) {
        m = new g.maps.Marker({ map, position: pos, title: d.from });
        m.__info = new g.maps.InfoWindow({ content });
        m.addListener('click', () => m.__info.open(map, m));
        markers.set(d.from, m);
      } else {
        m.setPosition(pos);
        m.__info?.setContent(content);
      }
      bounds.extend(pos);
    }
    for (const [k, m] of markers) {
      if (!seen.has(k)) {
        m.setMap(null);
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
