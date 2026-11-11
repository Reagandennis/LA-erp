import { NextRequest, NextResponse } from 'next/server';

import { enforceRateLimit } from '@/lib/rate-limit';
import type { ImportCodeChoices, ImportTarget } from '@/lib/shift-import';
import { RosterError, currentMonth, importRoster, rosterTemplateRows } from '@/lib/shift-planning';
import { monthParam, requireManager, respond } from '@/lib/shift-planning-route';
import { isCodeLike, isMonthKey, isShiftCode } from '@/lib/shift-rules';
import { SpreadsheetError, readSpreadsheet } from '@/lib/spreadsheet-read';

// node:zlib and Buffer are needed to open an .xlsx.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** A roster is a small table; anything bigger than this is the wrong file. */
const MAX_BYTES = 5 * 1024 * 1024;

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** The month as a spreadsheet to edit and upload again. */
export async function GET(request: NextRequest) {
  return respond(async () => {
    const { response } = await requireManager(request);
    if (response) return response;
    const month = monthParam(request, await currentMonth());
    const rows = await rosterTemplateRows(month);
    const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
    // BOM so Excel opens the UTF-8 (names with accents) correctly.
    return new NextResponse(new Uint8Array(Buffer.from('﻿' + csv, 'utf8')), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="roster-${month}.csv"`,
        'Cache-Control': 'private, no-store',
      },
    });
  });
}

function jsonObject(raw: FormDataEntryValue | null): Record<string, unknown> {
  if (typeof raw !== 'string' || !raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new RosterError('Invalid request.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new RosterError('Invalid request.');
  return parsed as Record<string, unknown>;
}

function mappingOf(raw: FormDataEntryValue | null): Record<string, ImportTarget> {
  const out: Record<string, ImportTarget> = {};
  for (const [key, value] of Object.entries(jsonObject(raw))) {
    if (value === 'new' || value === 'skip' || (typeof value === 'number' && Number.isInteger(value))) out[key] = value;
  }
  return out;
}

/** What each code the roster does not know should count as. */
function codesOf(raw: FormDataEntryValue | null): ImportCodeChoices {
  const out: ImportCodeChoices = {};
  for (const [key, value] of Object.entries(jsonObject(raw))) {
    if (isCodeLike(key) && (value === 'skip' || isShiftCode(value))) out[key] = value;
  }
  return out;
}

/**
 * Reads an uploaded roster (.xlsx or .csv) for a month. Without `apply` it
 * only reports what the file would do; with it, the month is filled.
 */
export async function POST(request: NextRequest) {
  return respond(async () => {
    const { ctx, response } = await requireManager(request);
    if (response) return response;

    const rateLimit = await enforceRateLimit({ scope: 'shift.import', key: `${ctx.actor.id}`, limit: 40, windowMs: 60 * 1000 });
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: 'Too many uploads. Wait a moment and try again.', retryAfterSeconds: rateLimit.retryAfterSeconds }, { status: 429 });
    }

    const form = await request.formData().catch(() => null);
    if (!form) throw new RosterError('Invalid request.');
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) throw new RosterError('Choose the roster file to upload.');
    if (file.size > MAX_BYTES) throw new RosterError(`“${file.name}” is larger than 5 MB, which is too big to be a roster.`);
    const month = form.get('month');
    if (!isMonthKey(month)) throw new RosterError('Pick the month this roster is for.');

    let sheets;
    try {
      sheets = readSpreadsheet(file.name, Buffer.from(await file.arrayBuffer()));
    } catch (error) {
      if (error instanceof SpreadsheetError) throw new RosterError(error.message);
      throw error;
    }

    const sheet = form.get('sheet');
    const forceReason = form.get('forceReason');
    const result = await importRoster(ctx.actor, {
      month,
      fileName: file.name.slice(0, 120),
      sheets,
      sheet: typeof sheet === 'string' && sheet ? sheet : null,
      blankAsOff: form.get('blankAsOff') === '1',
      mapping: mappingOf(form.get('mapping')),
      codes: codesOf(form.get('codes')),
      apply: form.get('apply') === '1',
      forceReason: typeof forceReason === 'string' ? forceReason : null,
    });
    return NextResponse.json(result);
  });
}
