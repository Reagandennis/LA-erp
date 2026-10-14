import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { enforceRateLimit } from '@/lib/rate-limit';
import { requireModuleRequest } from '@/lib/request-auth';
import {
  ARCHIVE_SELECT,
  CSV_HEADERS,
  archiveWhere,
  audioFileName,
  csvRow,
  fileStamp,
  parseArchiveFilter,
  safeName,
} from '@/lib/zello-archive';
import { buildZip, type ZipInput } from '@/lib/zip-writer';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';
// Pulling thousands of clips out of Postgres and zipping them can take a while.
export const maxDuration = 120;

/** Hard ceilings so one export can't exhaust memory: rows for CSV, clips + bytes for ZIP. */
const CSV_MAX_ROWS = 20_000;
const ZIP_MAX_CLIPS = 2_000;
const ZIP_MAX_AUDIO_BYTES = 400 * 1024 * 1024;
const AUDIO_BATCH = 100;

/**
 * Export the selected traffic.
 *
 *   ?format=csv  — one row per transmission / message (transcripts, translations, text)
 *   ?format=zip  — the same manifest.csv plus every stored recording as audio/*.wav
 *
 * Both take the same filters as /api/zello/archive. Every export is audited,
 * since this is how channel recordings leave the system.
 */
export async function GET(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, 'radio-zello');
  if (response || !auth) return response;

  const rateLimit = await enforceRateLimit({
    scope: 'zello.archive.export',
    key: `${auth.user.id}`,
    limit: 10,
    windowMs: 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many exports. Slow down and try again.' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    );
  }

  const { searchParams } = new URL(request.url);
  const format = searchParams.get('format') === 'zip' ? 'zip' : 'csv';
  const filter = parseArchiveFilter(searchParams);
  const where = archiveWhere(filter);

  const rows = await prisma.zelloActivity.findMany({
    where,
    orderBy: [{ at: 'asc' }, { id: 'asc' }],
    take: format === 'zip' ? ZIP_MAX_CLIPS : CSV_MAX_ROWS,
    select: ARCHIVE_SELECT,
  });

  const stamp = fileStamp(new Date());
  const scope = filter.channel ? safeName(filter.channel) : 'all-channels';
  const base = `zello-traffic_${scope}_${stamp}`;

  // ZIP bundles get the clip path; a bare CSV has no files to point at.
  const fileFor = (r: (typeof rows)[number]) => (format === 'zip' && r.hasAudio ? audioFileName(r) : '');
  const manifest = [CSV_HEADERS.join(','), ...rows.map((r) => csvRow(r, fileFor(r)))].join('\r\n') + '\r\n';

  await recordAuditEvent({
    action: 'zello.archive.exported',
    entityType: 'zello-archive',
    entityId: filter.channel ?? null,
    actorUserId: auth.user.id,
    metadata: {
      format,
      rows: rows.length,
      channel: filter.channel,
      from: filter.from?.toISOString() ?? null,
      to: filter.to?.toISOString() ?? null,
      speaker: filter.speaker,
      kind: filter.kind,
      q: filter.q,
    },
    request,
  });

  if (format === 'csv') {
    // BOM so Excel opens the UTF-8 (Swahili / Amharic transcripts) correctly.
    const body = Buffer.from('﻿' + manifest, 'utf8');
    return new NextResponse(new Uint8Array(body), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${base}.csv"`,
        'Cache-Control': 'private, no-store',
      },
    });
  }

  const entries: ZipInput[] = [{ name: 'manifest.csv', data: Buffer.from('﻿' + manifest, 'utf8') }];
  const withAudio = rows.filter((r) => r.hasAudio);
  let audioBytes = 0;
  let truncated = false;

  // Fetch the bytes in batches rather than one query per clip, but never all at once.
  for (let i = 0; i < withAudio.length && !truncated; i += AUDIO_BATCH) {
    const batch = withAudio.slice(i, i + AUDIO_BATCH);
    const clips = await prisma.zelloActivity.findMany({
      where: { id: { in: batch.map((r) => r.id) } },
      select: { id: true, audio: true },
    });
    const byId = new Map(clips.map((c) => [c.id, c.audio as Buffer | null]));
    for (const r of batch) {
      const audio = byId.get(r.id);
      if (!audio?.length) continue;
      if (audioBytes + audio.length > ZIP_MAX_AUDIO_BYTES) {
        truncated = true;
        break;
      }
      audioBytes += audio.length;
      entries.push({ name: audioFileName(r), data: audio });
    }
  }

  const notes = [
    `Zello radio traffic export`,
    `Generated: ${new Date().toISOString()}`,
    `Network: ${filter.network || '(default)'}`,
    `Channel: ${filter.channel ?? 'all'}`,
    `From: ${filter.from?.toISOString() ?? '-'}   To: ${filter.to?.toISOString() ?? '-'}`,
    `Rows: ${rows.length}   Recordings: ${entries.length - 1}`,
    `Audio: 16 kHz mono WAV, one file per transmission; manifest.csv column "audioFile" links each row to its clip.`,
  ];
  if (rows.length >= ZIP_MAX_CLIPS) notes.push(`NOTE: capped at ${ZIP_MAX_CLIPS} rows — narrow the date range to export the rest.`);
  if (truncated) notes.push(`NOTE: recordings stopped at the ${Math.round(ZIP_MAX_AUDIO_BYTES / 1024 / 1024)} MB audio limit — narrow the date range to export the rest.`);
  entries.push({ name: 'README.txt', data: Buffer.from(notes.join('\n') + '\n', 'utf8') });

  const zip = buildZip(entries);
  return new NextResponse(new Uint8Array(zip), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${base}.zip"`,
      'Content-Length': String(zip.length),
      'Cache-Control': 'private, no-store',
    },
  });
}
