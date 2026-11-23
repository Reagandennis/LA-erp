import 'server-only';

// MIME types that may render inline. Everything else is forced to download as
// application/octet-stream so stored uploads can never execute same-origin.
// image/svg+xml is deliberately excluded — SVG can carry script.
const INLINE_SAFE = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
]);

/**
 * Whether a response of this type may render in the browser rather than being
 * forced to download. Exported so callers can decide *before* offering a
 * preview — offering one for a type that ends up as an attachment opens a blank
 * tab and silently downloads instead.
 */
export function isInlineSafe(mime: string): boolean {
  return INLINE_SAFE.has(mime.split(';')[0].trim().toLowerCase());
}

/**
 * A Content-Disposition value any name survives. Header values must be
 * Latin-1, and macOS names screenshots "Photo 11.20.36\u202fPM.png" (a narrow
 * no-break space before PM), which made the whole response throw. The plain
 * `filename` gets an ASCII stand-in; `filename*` (RFC 6266/5987) carries the
 * real name for browsers, which all read it.
 */
export function contentDisposition(type: 'inline' | 'attachment', name: string): string {
  const cleaned = name.replace(/[\r\n]/g, '').trim() || 'file';
  const ascii = cleaned
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, (ch) => (/\s/.test(ch) ? ' ' : '_'))
    .replace(/["\\]/g, '');
  if (ascii === cleaned) return `${type}; filename="${ascii}"`;
  const encoded = encodeURIComponent(cleaned).replace(/['()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export function fileResponse(input: {
  content: Buffer | Uint8Array;
  mime: string;
  name: string;
  download?: boolean;
  cacheControl?: string;
}) {
  const body = new Uint8Array(input.content);
  const baseMime = input.mime.split(';')[0].trim().toLowerCase();
  const safeInline = INLINE_SAFE.has(baseMime);
  const disposition = safeInline && !input.download ? 'inline' : 'attachment';

  return new Response(body, {
    headers: {
      'Content-Type': safeInline ? input.mime : 'application/octet-stream',
      'Content-Disposition': contentDisposition(disposition, input.name),
      'Content-Length': String(body.byteLength),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': input.cacheControl ?? 'private, no-store',
    },
  });
}
