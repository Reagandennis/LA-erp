/**
 * CSV → point features.
 *
 * A full RFC-4180 reader (quoted fields, embedded delimiters and newlines, `""`
 * escapes) plus header sniffing, because the spreadsheets people actually upload
 * label their columns half a dozen different ways. Rows whose coordinates will
 * not parse are counted and reported rather than failing the whole import.
 */

import type { ParsedFeature } from './map-types';

// Normalisation strips punctuation, so "Lat (DD)" arrives here as "latdd".
const LAT_KEYS = ['lat', 'latdd', 'latitude', 'latitudedd', 'y', 'ycoord', 'ycoordinate'];
const LNG_KEYS = [
  'lon', 'londd', 'lng', 'lngdd', 'long', 'longdd',
  'longitude', 'longitudedd', 'x', 'xcoord', 'xcoordinate',
];
const NAME_KEYS = ['name', 'title', 'label', 'site', 'location', 'place'];
const CATEGORY_KEYS = ['category', 'type', 'group', 'class', 'kind'];
const DESCRIPTION_KEYS = ['description', 'notes', 'note', 'comment', 'comments', 'remarks'];

/** Lowercase and strip anything that is not a letter or digit, so "Lat (DD)" → "latdd". */
function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Pick the delimiter by counting candidates outside quotes on the first line. */
function sniffDelimiter(text: string): string {
  const line = text.slice(0, text.search(/\r?\n/) === -1 ? text.length : text.search(/\r?\n/));
  const counts = [',', ';', '\t', '|'].map((d) => ({
    d,
    n: line.split(d).length - 1,
  }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 0 ? counts[0].d : ',';
}

/** Split a CSV document into rows of raw cell strings. */
export function parseCsv(text: string, delimiter?: string): string[][] {
  const source = text.replace(/^﻿/, '');
  const delim = delimiter ?? sniffDelimiter(source);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    // A trailing newline should not produce a phantom empty row.
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };

  while (i < source.length) {
    const c = source[i];

    if (quoted) {
      if (c === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }

    if (c === '"' && field === '') {
      quoted = true;
      i += 1;
      continue;
    }
    if (c === delim) {
      endField();
      i += 1;
      continue;
    }
    if (c === '\r') {
      i += 1;
      continue;
    }
    if (c === '\n') {
      endRow();
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }

  if (field !== '' || row.length > 0) endRow();
  return rows;
}

function indexOfHeader(headers: string[], keys: string[]): number {
  return headers.findIndex((h) => keys.includes(h));
}

/**
 * Coordinates may arrive as plain decimals or with a hemisphere suffix ("1.29 S").
 * Anything else is rejected so the row can be reported as skipped.
 */
function parseCoordinate(raw: string): number | null {
  const value = raw.trim();
  if (!value) return null;
  const m = /^(-?\d+(?:\.\d+)?)\s*([NnSsEeWw])?$/.exec(value);
  if (!m) return null;
  let n = Number.parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const hemisphere = m[2]?.toUpperCase();
  if (hemisphere === 'S' || hemisphere === 'W') n = -Math.abs(n);
  return n;
}

export interface CsvImportResult {
  features: ParsedFeature[];
  skipped: number;
  warnings: string[];
}

export function csvToFeatures(text: string): CsvImportResult {
  const rows = parseCsv(text);
  if (rows.length === 0) {
    return { features: [], skipped: 0, warnings: ['The file is empty.'] };
  }

  const rawHeaders = rows[0];
  const headers = rawHeaders.map(normalizeHeader);
  const latIdx = indexOfHeader(headers, LAT_KEYS);
  const lngIdx = indexOfHeader(headers, LNG_KEYS);

  if (latIdx === -1 || lngIdx === -1) {
    return {
      features: [],
      skipped: 0,
      warnings: [
        'No latitude/longitude columns found. Expected a header like "lat"/"latitude" and "lon"/"lng"/"longitude".',
      ],
    };
  }

  const nameIdx = indexOfHeader(headers, NAME_KEYS);
  const categoryIdx = indexOfHeader(headers, CATEGORY_KEYS);
  const descriptionIdx = indexOfHeader(headers, DESCRIPTION_KEYS);
  const consumed = new Set([latIdx, lngIdx, nameIdx, categoryIdx, descriptionIdx]);

  const features: ParsedFeature[] = [];
  const warnings: string[] = [];
  let skipped = 0;

  for (let r = 1; r < rows.length; r += 1) {
    const row = rows[r];
    const lat = parseCoordinate(row[latIdx] ?? '');
    const lng = parseCoordinate(row[lngIdx] ?? '');
    if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      skipped += 1;
      continue;
    }

    const properties: Record<string, string> = {};
    for (let c = 0; c < row.length; c += 1) {
      if (consumed.has(c)) continue;
      const key = rawHeaders[c]?.trim();
      const value = row[c]?.trim();
      if (key && value) properties[key] = value;
    }

    features.push({
      name: (nameIdx >= 0 ? row[nameIdx]?.trim() : '') || `Row ${r}`,
      description: (descriptionIdx >= 0 ? row[descriptionIdx]?.trim() : '') || null,
      geometry: { type: 'Point', coordinates: [lng, lat] },
      properties,
      category: (categoryIdx >= 0 ? row[categoryIdx]?.trim() : '') || null,
      style: null,
    });
  }

  if (skipped > 0) {
    const plural = skipped === 1 ? 'row had' : 'rows had';
    warnings.push(`${skipped} ${plural} no usable coordinates and ${skipped === 1 ? 'was' : 'were'} skipped.`);
  }
  return { features, skipped, warnings };
}
