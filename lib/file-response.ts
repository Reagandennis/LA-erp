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
  const filename = input.name.replace(/["\\\r\n]/g, '');
  const disposition = safeInline && !input.download ? 'inline' : 'attachment';

  return new Response(body, {
    headers: {
      'Content-Type': safeInline ? input.mime : 'application/octet-stream',
      'Content-Disposition': `${disposition}; filename="${filename}"`,
      'Content-Length': String(body.byteLength),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': input.cacheControl ?? 'private, no-store',
    },
  });
}
