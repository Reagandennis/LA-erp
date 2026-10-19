/**
 * The photos and documents an itinerary event may carry. Client-safe, so the
 * picker filters with the same list the server enforces (lib/trip-attachments).
 *
 * Nothing that can run (HTML, SVG, scripts) — and lib/file-response forces
 * anything but images, PDFs and text to download regardless.
 */
export const TYPES_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

const ALLOWED_TYPES = new Set(Object.values(TYPES_BY_EXTENSION));

/** Photos and documents on one event. */
export const MAX_ATTACHMENTS_PER_ITEM = 20;

/** For `<input type="file" accept>`. */
export const ATTACHMENT_ACCEPT = Object.keys(TYPES_BY_EXTENSION)
  .map((extension) => `.${extension}`)
  .join(',');

/**
 * The stored type for an upload, or null when it isn't one we take. Browsers
 * often send nothing or `application/octet-stream` for office files, so the
 * extension decides then — but a declared type must still be on the list.
 */
export function resolveAttachmentType(file: { name: string; type: string }): string | null {
  const declared = file.type.split(';')[0].trim().toLowerCase();
  if (declared && declared !== 'application/octet-stream') {
    return ALLOWED_TYPES.has(declared) ? declared : null;
  }
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return TYPES_BY_EXTENSION[extension] ?? null;
}

/** Images every browser can draw, so they get a thumbnail and the viewer. */
export function isPreviewableImage(mimeType: string): boolean {
  return ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mimeType.toLowerCase());
}

/** "2.4 MB", "830 KB". */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
