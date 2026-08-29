/**
 * One entry point for every map import format, so the upload route stays thin.
 */

import { csvToFeatures } from './geo-csv';
import { kmlToFeatures } from './geo-kml';
import { readZipEntries } from './geo-zip';
import type { ImportSource, ParsedFeature } from './map-types';

/** Guards against a single archive dumping an unbounded number of rows into Postgres. */
export const MAX_IMPORT_FEATURES = 5000;

export const IMPORT_EXTENSIONS = ['.kmz', '.kml', '.csv'] as const;

export interface MapImportResult {
  source: ImportSource;
  features: ParsedFeature[];
  skipped: number;
  warnings: string[];
}

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? '' : fileName.slice(dot).toLowerCase();
}

export function isSupportedImport(fileName: string): boolean {
  return (IMPORT_EXTENSIONS as readonly string[]).includes(extensionOf(fileName));
}

/** Pull the document out of a KMZ: `doc.kml` by convention, else the first KML present. */
function kmlFromKmz(bytes: Buffer): { xml: string; warnings: string[] } {
  const entries = readZipEntries(bytes);
  const kml =
    entries.find((e) => e.name.toLowerCase() === 'doc.kml') ??
    entries.find((e) => !e.name.includes('/') && e.name.toLowerCase().endsWith('.kml')) ??
    entries.find((e) => e.name.toLowerCase().endsWith('.kml'));

  if (!kml) throw new Error('This KMZ contains no .kml document.');

  const warnings: string[] = [];
  const hasImages = entries.some((e) => /\.(png|jpe?g|gif|svg|bmp)$/i.test(e.name));
  if (hasImages) {
    warnings.push(
      'Custom icon images inside the KMZ were not imported — features use the category icon instead.',
    );
  }
  return { xml: kml.data.toString('utf8'), warnings };
}

export function parseMapUpload(input: { fileName: string; bytes: Buffer }): MapImportResult {
  const ext = extensionOf(input.fileName);

  if (ext === '.csv') {
    const { features, skipped, warnings } = csvToFeatures(input.bytes.toString('utf8'));
    return { source: 'csv', ...capped(features, warnings), skipped };
  }

  if (ext === '.kml') {
    const features = kmlToFeatures(input.bytes.toString('utf8'));
    return { source: 'kml', ...capped(features, []), skipped: 0 };
  }

  if (ext === '.kmz') {
    const { xml, warnings } = kmlFromKmz(input.bytes);
    const features = kmlToFeatures(xml);
    return { source: 'kmz', ...capped(features, warnings), skipped: 0 };
  }

  throw new Error(`Unsupported file type "${ext || input.fileName}". Upload a .kmz, .kml or .csv.`);
}

function capped(
  features: ParsedFeature[],
  warnings: string[],
): { features: ParsedFeature[]; warnings: string[] } {
  if (features.length <= MAX_IMPORT_FEATURES) return { features, warnings };
  return {
    features: features.slice(0, MAX_IMPORT_FEATURES),
    warnings: [
      ...warnings,
      `Only the first ${MAX_IMPORT_FEATURES} of ${features.length} features were imported.`,
    ],
  };
}
