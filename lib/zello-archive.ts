/**
 * Radio (Zello) traffic archive — shared filter parsing for the browse and export
 * endpoints so both agree on what "the selected traffic" means.
 */

import type { Prisma } from '@prisma/client';

export interface ArchiveFilter {
  network: string;
  channel: string | null;
  from: Date | null;
  to: Date | null;
  speaker: string | null;
  kind: 'voice' | 'text' | null;
  q: string | null;
  /** Only rows that still carry a stored recording. */
  withAudio: boolean;
}

function parseDate(raw: string | null, endOfDay: boolean): Date | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  // Accept a bare YYYY-MM-DD (from a date input) or a full ISO timestamp.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseArchiveFilter(params: URLSearchParams): ArchiveFilter {
  const kindRaw = (params.get('kind') ?? '').trim();
  const str = (key: string, max = 200): string | null => {
    const s = (params.get(key) ?? '').trim();
    return s ? s.slice(0, max) : null;
  };
  return {
    network: (params.get('network') ?? '').trim(),
    channel: str('channel'),
    from: parseDate(params.get('from'), false),
    to: parseDate(params.get('to'), true),
    speaker: str('speaker'),
    kind: kindRaw === 'voice' || kindRaw === 'text' ? kindRaw : null,
    q: str('q', 300),
    withAudio: params.get('withAudio') === '1',
  };
}

export function archiveWhere(f: ArchiveFilter): Prisma.ZelloActivityWhereInput {
  // A blank network means "everything" — the archive shouldn't hide traffic just
  // because the console's saved network differs from how the row was recorded.
  const where: Prisma.ZelloActivityWhereInput = f.network ? { network: f.network } : {};
  if (f.channel) where.channel = f.channel;
  if (f.speaker) where.fromName = { contains: f.speaker, mode: 'insensitive' };
  if (f.kind) where.kind = f.kind;
  if (f.withAudio) where.hasAudio = true;
  if (f.from || f.to) {
    where.at = {};
    if (f.from) where.at.gte = f.from;
    if (f.to) where.at.lte = f.to;
  }
  if (f.q) {
    const m = { contains: f.q, mode: 'insensitive' as const };
    where.OR = [{ text: m }, { transcript: m }, { translation: m }];
  }
  return where;
}

/** Fields the archive list and export both read; never the audio bytes. */
export const ARCHIVE_SELECT = {
  id: true,
  network: true,
  channel: true,
  kind: true,
  fromName: true,
  direction: true,
  text: true,
  transcript: true,
  translation: true,
  language: true,
  durationMs: true,
  hasAudio: true,
  at: true,
} as const;

export type ArchiveRow = Prisma.ZelloActivityGetPayload<{ select: typeof ARCHIVE_SELECT }>;

/** `2026-10-14T12-23-51Z` — sortable and safe on every filesystem. */
export function fileStamp(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');
}

export function safeName(s: string): string {
  return s.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'unknown';
}

export function csvEscape(cell: unknown): string {
  const s = cell == null ? '' : String(cell);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_HEADERS = [
  'id',
  'at',
  'network',
  'channel',
  'kind',
  'from',
  'direction',
  'durationSeconds',
  'language',
  'text',
  'transcript',
  'translation',
  'audioFile',
] as const;

export function csvRow(r: ArchiveRow, audioFile: string): string {
  return [
    r.id,
    r.at.toISOString(),
    r.network,
    r.channel,
    r.kind,
    r.fromName,
    r.direction,
    r.durationMs != null ? (r.durationMs / 1000).toFixed(1) : '',
    r.language ?? '',
    r.text ?? '',
    r.transcript ?? '',
    r.translation ?? '',
    audioFile,
  ]
    .map(csvEscape)
    .join(',');
}

export function audioFileName(r: ArchiveRow): string {
  return `audio/${fileStamp(r.at)}_${safeName(r.channel)}_${safeName(r.fromName)}_${r.id}.wav`;
}
