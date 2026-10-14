import type { NextConfig } from "next";

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://accounts.google.com https://maps.googleapis.com",
  "style-src 'self' 'unsafe-inline'",
  // Raster map tiles are plain <img> loads, so every basemap host must be listed here.
  "img-src 'self' data: blob: https://maps.gstatic.com https://*.googleapis.com " +
    'https://*.tile.openstreetmap.org https://*.tile.opentopomap.org ' +
    'https://server.arcgisonline.com https://*.basemaps.cartocdn.com ' +
    'https://*.tile-cyclosm.openstreetmap.fr https://tileserver.memomaps.de',
  "connect-src 'self' https://*.googleapis.com https://accounts.google.com",
  "frame-src https://accounts.google.com",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

const nextConfig: NextConfig = {
  // Drop the X-Powered-By header: one less byte per response and no version hint.
  poweredByHeader: false,
  // Automatic memoization for client components (the big module screens
  // re-render far less). Components that break the rules of React are skipped.
  reactCompiler: true,
  // When the reverse proxy (Caddy `encode zstd gzip`) already compresses
  // responses, let it own that CPU work instead of Node. Read at build time.
  compress: process.env.REVERSE_PROXY_COMPRESSION !== 'true',
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // microphone=(self) is required by the Zello push-to-talk module.
          { key: 'Permissions-Policy', value: 'geolocation=(self), microphone=(self), camera=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          // Report-only until the Google Maps / Sign-In sources are confirmed
          // against real traffic; rename to Content-Security-Policy once quiet.
          { key: 'Content-Security-Policy-Report-Only', value: CONTENT_SECURITY_POLICY },
        ],
      },
    ];
  },
};

export default nextConfig;
