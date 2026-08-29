/**
 * The single Google Maps JS API loader for the whole app.
 *
 * The script tag can only be injected once per page and its `libraries=` list is
 * frozen at that moment, so every caller has to ask for the same superset — or
 * whichever map mounts second silently loses a library it needs. Hence one
 * constant list here rather than a per-caller argument.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * marker → AdvancedMarkerElement, geometry → spherical/poly helpers.
 *
 * `drawing` is deliberately absent: DrawingManager was withdrawn in Maps JS 3.65
 * and now throws from its constructor even though the namespace still resolves,
 * so the map module draws shapes from core map events instead.
 */
export const MAPS_LIBRARIES = 'marker,geometry';

const CALLBACK = '__laErpGmapsReady';
const LOAD_TIMEOUT_MS = 12_000;

let mapsPromise: Promise<void> | null = null;

/**
 * Google reports a bad key, a blocked referrer or unpaid billing by calling
 * `gm_authFailure` — *after* the bootstrap callback has already resolved, and
 * only by painting its own grey overlay over the map. Without this hook the app
 * looks broken and says nothing, so capture it and let components render a real
 * explanation instead.
 */
let authFailure: string | null = null;
const authListeners = new Set<(reason: string) => void>();

const AUTH_FAILURE_MESSAGE =
  'Google rejected the Maps API key. Check that the key is correct, that the Maps ' +
  'JavaScript API is enabled for its project, that billing is active, and that this ' +
  'origin is allowed on the key.';

/** The reason Maps refused to authenticate, or null while it is still healthy. */
export function mapsAuthFailure(): string | null {
  return authFailure;
}

/** Subscribe to an auth failure. Fires immediately if one has already happened. */
export function onMapsAuthFailure(listener: (reason: string) => void): () => void {
  if (authFailure) listener(authFailure);
  authListeners.add(listener);
  return () => authListeners.delete(listener);
}

/**
 * Record an auth failure and tell every subscriber. Exported so the behaviour is
 * reachable without a browser — `gm_authFailure` is the only caller in the app.
 */
export function reportMapsAuthFailure(reason: string = AUTH_FAILURE_MESSAGE): void {
  authFailure = reason;
  for (const listener of authListeners) listener(reason);
}

function installAuthFailureHook(): void {
  if (typeof window === 'undefined') return;
  (window as any).gm_authFailure = () => reportMapsAuthFailure();
}

export function loadGoogleMaps(key: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no-window'));
  if ((window as any).google?.maps) return Promise.resolve();
  if (mapsPromise) return mapsPromise;
  installAuthFailureHook();
  mapsPromise = new Promise<void>((resolve, reject) => {
    // Use the documented callback param — it fires only once google.maps (incl. Map)
    // is fully ready. Relying on script onload races the async library load and throws.
    const timer = setTimeout(() => reject(new Error('maps-timeout')), LOAD_TIMEOUT_MS);
    (window as any)[CALLBACK] = () => {
      clearTimeout(timer);
      resolve();
    };
    const s = document.createElement('script');
    s.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}` +
      `&libraries=${MAPS_LIBRARIES}&v=weekly&loading=async&callback=${CALLBACK}`;
    s.async = true;
    s.onerror = () => {
      clearTimeout(timer);
      reject(new Error('maps-failed'));
    };
    document.head.appendChild(s);
  });
  return mapsPromise;
}

/** Browser-side Maps key. Written as a literal member expression so Next inlines it. */
export const MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

/**
 * AdvancedMarkerElement requires a Map ID. Use a configured one in production;
 * fall back to Google's DEMO_MAP_ID for local/dev.
 */
export const MAPS_MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || 'DEMO_MAP_ID';

/** True when the Map ID is Google's demo — boundary feature layers are unavailable on it. */
export const IS_DEMO_MAP_ID = MAPS_MAP_ID === 'DEMO_MAP_ID';
