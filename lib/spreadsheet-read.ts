/**
 * Reads an uploaded spreadsheet into plain rows of text: `.xlsx` workbooks and
 * delimited text (`.csv`, `.tsv`, Excel's "Unicode Text").
 *
 * Only what a table of values needs: cell text, numbers, and dates (which Excel
 * stores as day counts and marks through the cell's number format). Formulas
 * arrive as their last calculated value; formatting, merges and charts are
 * ignored. An `.xlsx` is a zip of XML parts, opened with the same small zip
 * reader the map import uses rather than a spreadsheet library.
 */

import { parseCsv } from './geo-csv';
import { readZipEntries } from './geo-zip';

export interface SheetData {
  name: string;
  /** Hidden in the workbook: read, but never the first choice. */
  hidden: boolean;
  /** Row by row, every cell as trimmed text; a date cell as 'YYYY-MM-DD'. */
  rows: string[][];
}

/** A problem with the file itself, worded for the person who uploaded it. */
export class SpreadsheetError extends Error {}

const MAX_ROWS = 2000;
const MAX_COLUMNS = 400;
const MAX_SHEETS = 40;
/** No sheet of a table for people inflates anywhere near this; a part that does is not one. */
const MAX_PART_BYTES = 16 * 1024 * 1024;

export const SPREADSHEET_EXTENSIONS = ['.xlsx', '.csv', '.tsv', '.txt'] as const;

export function readSpreadsheet(fileName: string, bytes: Buffer): SheetData[] {
  if (bytes.length === 0) throw new SpreadsheetError('That file is empty.');
  // By content, not by name: people rename files.
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return readXlsx(bytes);
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    throw new SpreadsheetError(
      'This is an older Excel file (.xls), or one protected with a password. In Excel choose File → Save As and pick "Excel Workbook (.xlsx)" or "CSV", then upload that.',
    );
  }
  const name = fileName.replace(/\.[^.]+$/, '') || 'Sheet';
  return [{ name, hidden: false, rows: readDelimited(bytes) }];
}

// --- Delimited text ------------------------------------------------------------

function decodeText(bytes: Buffer): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // Excel's plain "CSV" on Windows is not UTF-8.
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** The separator the file uses, judged over its first lines (a title line has none). */
function sniffDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((line) => line.trim()).slice(0, 12);
  let best = ',';
  let bestCount = 0;
  for (const delimiter of [',', ';', '\t', '|']) {
    const count = lines.reduce((sum, line) => sum + (line.split(delimiter).length - 1), 0);
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }
  return best;
}

function readDelimited(bytes: Buffer): string[][] {
  const text = decodeText(bytes).replace(/^﻿/, '');
  if (text.includes('\u0000')) throw new SpreadsheetError('That file is not a spreadsheet. Upload an .xlsx or .csv file.');
  return tidy(parseCsv(text, sniffDelimiter(text)));
}

function tidy(rows: string[][]): string[][] {
  const out = rows.slice(0, MAX_ROWS).map((row) => {
    const cells = row.slice(0, MAX_COLUMNS).map((cell) => cell.replace(/\s+/g, ' ').trim());
    while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
    return cells;
  });
  while (out.length > 0 && (out[out.length - 1] as string[]).length === 0) out.pop();
  return out;
}

// --- .xlsx ---------------------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXml(text: string): string {
  return text
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, entity: string) => {
      const key = entity.toLowerCase();
      if (key.startsWith('#x')) return String.fromCodePoint(Number.parseInt(key.slice(2), 16) || 0xfffd);
      if (key.startsWith('#')) return String.fromCodePoint(Number.parseInt(key.slice(1), 10) || 0xfffd);
      return ENTITIES[key] ?? whole;
    })
    // Excel's own escape for control characters, e.g. a carriage return inside a cell.
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return code < 32 ? ' ' : String.fromCharCode(code);
    });
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tag);
  return match ? decodeXml(match[1] ?? match[2] ?? '') : null;
}

/** The text inside every <t> of a string item or an inline string, without phonetic guides. */
function textRuns(xml: string): string {
  const body = xml.replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, '');
  let out = '';
  for (const match of body.matchAll(/<(?:\w+:)?t\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?t>)/g)) out += decodeXml(match[1] ?? '');
  return out;
}

function sharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const out: string[] = [];
  for (const match of xml.matchAll(/<(?:\w+:)?si\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?si>)/g)) out.push(textRuns(match[1] ?? ''));
  return out;
}

/** Built-in number formats that show a date or a time. */
function builtInDate(id: number): boolean {
  return (id >= 14 && id <= 22) || (id >= 27 && id <= 36) || (id >= 45 && id <= 47) || (id >= 50 && id <= 58);
}

function dateFormatCode(code: string): boolean {
  const bare = code
    .replace(/"[^"]*"/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\\./g, '')
    .toLowerCase();
  return bare !== 'general' && /[dmyhs]/.test(bare);
}

/** For each cell style index: does it show its number as a date? */
function dateStyles(xml: string | undefined): boolean[] {
  if (!xml) return [];
  const custom = new Map<number, boolean>();
  for (const match of xml.matchAll(/<(?:\w+:)?numFmt\b([^>]*)\/?>/g)) {
    const id = Number(attribute(match[1] ?? '', 'numFmtId'));
    custom.set(id, dateFormatCode(attribute(match[1] ?? '', 'formatCode') ?? ''));
  }
  const block = /<(?:\w+:)?cellXfs\b[^>]*>([\s\S]*?)<\/(?:\w+:)?cellXfs>/.exec(xml)?.[1] ?? '';
  const out: boolean[] = [];
  for (const match of block.matchAll(/<(?:\w+:)?xf\b([^>]*?)\/?>/g)) {
    const id = Number(attribute(match[1] ?? '', 'numFmtId') ?? 0);
    out.push(custom.get(id) ?? builtInDate(id));
  }
  return out;
}

const DAY_MS = 86_400_000;

/** An Excel day count as 'YYYY-MM-DD', or null when it is not a plausible date. */
export function excelSerialToDate(serial: number, date1904 = false): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2_958_465) return null;
  // The 1900 system counts a 29 Feb 1900 that never existed, so its day 0 is 30 Dec 1899.
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  return new Date(epoch + Math.floor(serial) * DAY_MS).toISOString().slice(0, 10);
}

/** 'A' → 0, 'Z' → 25, 'AA' → 26. */
function columnIndex(ref: string): number {
  let n = 0;
  for (const char of ref.toUpperCase()) {
    const code = char.charCodeAt(0);
    if (code < 65 || code > 90) break;
    n = n * 26 + (code - 64);
  }
  return n - 1;
}

function numberText(raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw.trim();
  // 1.0000000000000002 and friends: a stored float, shown as the number it stands for.
  return String(Math.round(n * 1e10) / 1e10);
}

function readSheet(xml: string, strings: string[], isDate: boolean[], date1904: boolean): string[][] {
  const data = /<(?:\w+:)?sheetData\b[^>]*>([\s\S]*?)<\/(?:\w+:)?sheetData>/.exec(xml)?.[1] ?? '';
  const rows: string[][] = [];
  let nextRow = 0;
  for (const rowMatch of data.matchAll(/<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g)) {
    const given = Number(attribute(rowMatch[1] ?? '', 'r'));
    const rowIndex = Number.isInteger(given) && given > 0 ? given - 1 : nextRow;
    nextRow = rowIndex + 1;
    if (rowIndex >= MAX_ROWS) break;
    const cells: string[] = [];
    let nextColumn = 0;
    for (const cellMatch of (rowMatch[2] ?? '').matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const tag = cellMatch[1] ?? '';
      const body = cellMatch[2] ?? '';
      const ref = attribute(tag, 'r');
      const column = ref ? columnIndex(ref) : nextColumn;
      nextColumn = column + 1;
      if (column < 0 || column >= MAX_COLUMNS) continue;

      const type = attribute(tag, 't') ?? 'n';
      const raw = /<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/.exec(body)?.[1];
      let text = '';
      if (type === 'inlineStr') text = textRuns(body);
      else if (raw === undefined) text = '';
      else if (type === 's') text = strings[Number(raw)] ?? '';
      else if (type === 'str') text = decodeXml(raw);
      else if (type === 'b') text = raw.trim() === '1' ? 'TRUE' : 'FALSE';
      else if (type === 'e') text = '';
      else if (type === 'd') text = raw.trim().slice(0, 10);
      else {
        const style = Number(attribute(tag, 's') ?? 0);
        text = (isDate[style] ? excelSerialToDate(Number(raw), date1904) : null) ?? numberText(raw);
      }
      while (cells.length < column) cells.push('');
      cells[column] = text;
    }
    while (rows.length < rowIndex) rows.push([]);
    rows[rowIndex] = cells;
  }
  return tidy(rows);
}

function readXlsx(bytes: Buffer): SheetData[] {
  let parts: Map<string, string>;
  try {
    const wanted = /^(xl\/workbook\.xml|xl\/_rels\/workbook\.xml\.rels|xl\/sharedStrings\.xml|xl\/styles\.xml|xl\/worksheets\/[^/]+\.xml)$/i;
    let worksheets = 0;
    const only = (entry: string) => {
      const name = entry.replace(/^\//, '');
      if (!wanted.test(name)) return false;
      // Past the sheets that will be read, nothing more is unpacked.
      return !/worksheets\//i.test(name) || (worksheets += 1) <= MAX_SHEETS;
    };
    parts = new Map(
      readZipEntries(bytes, { only, maxEntryBytes: MAX_PART_BYTES }).map((entry) => [
        entry.name.replace(/^\//, '').toLowerCase(),
        entry.data.toString('utf8'),
      ]),
    );
  } catch {
    throw new SpreadsheetError('That file could not be opened. Save it again as an Excel workbook (.xlsx) or a CSV and upload that.');
  }
  const workbook = parts.get('xl/workbook.xml');
  if (!workbook) {
    throw new SpreadsheetError('That file is not an Excel workbook. Upload an .xlsx or .csv file.');
  }

  const targets = new Map<string, string>();
  for (const match of (parts.get('xl/_rels/workbook.xml.rels') ?? '').matchAll(/<(?:\w+:)?Relationship\b([^>]*?)\/?>/g)) {
    const id = attribute(match[1] ?? '', 'Id');
    const target = attribute(match[1] ?? '', 'Target');
    if (id && target) targets.set(id, (target.startsWith('/') ? target.slice(1) : `xl/${target}`).toLowerCase());
  }

  const strings = sharedStrings(parts.get('xl/sharedstrings.xml'));
  const isDate = dateStyles(parts.get('xl/styles.xml'));
  const date1904 = /<(?:\w+:)?workbookPr\b[^>]*\bdate1904\s*=\s*["'](1|true)["']/i.test(workbook);

  const sheets: SheetData[] = [];
  let position = 0;
  for (const match of workbook.matchAll(/<(?:\w+:)?sheet\b([^>]*?)\/?>/g)) {
    position += 1;
    if (sheets.length >= MAX_SHEETS) break;
    const tag = match[1] ?? '';
    const relation = attribute(tag, 'r:id') ?? attribute(tag, 'id');
    const path = (relation && targets.get(relation)) || `xl/worksheets/sheet${position}.xml`;
    const xml = parts.get(path);
    if (!xml) continue;
    const state = attribute(tag, 'state');
    sheets.push({
      name: attribute(tag, 'name') ?? `Sheet ${position}`,
      hidden: state === 'hidden' || state === 'veryHidden',
      rows: readSheet(xml, strings, isDate, date1904),
    });
  }
  if (sheets.length === 0) throw new SpreadsheetError('That workbook has no sheets to read.');
  return sheets;
}
