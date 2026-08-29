/** Display helpers shared by the map shell and its panels. */

export function timeAgo(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// Live within 5 min, recent within an hour, otherwise stale.
export function freshnessDot(at: number, now: number): string {
  const min = (now - at) / 60000;
  if (min <= 5) return 'bg-emerald-500';
  if (min <= 60) return 'bg-amber-500';
  return 'bg-gray-300';
}

export function formatBytes(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatArea(squareMeters: number): string {
  if (squareMeters < 10_000) return `${Math.round(squareMeters).toLocaleString()} m²`;
  return `${(squareMeters / 1_000_000).toFixed(2)} km²`;
}

export function formatLength(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

/** Darken a #rrggbb colour, for the border of a marker pin. */
export function darken(hex: string, amount = 0.35): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = Number.parseInt(m[1], 16);
  const scale = (channel: number) => Math.max(0, Math.round(channel * (1 - amount)));
  const r = scale((n >> 16) & 0xff);
  const g = scale((n >> 8) & 0xff);
  const b = scale(n & 0xff);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
