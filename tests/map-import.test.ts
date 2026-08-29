import { deflateRawSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { MAX_IMPORT_FEATURES, extensionOf, isSupportedImport, parseMapUpload } from '../lib/geo-import';

/** Minimal single-entry zip, which is all a KMZ is. */
function kmz(entries: Array<{ name: string; text: string }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const content = Buffer.from(entry.text, 'utf8');
    const stored = deflateRawSync(content);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, stored);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(stored.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + stored.length;
  }

  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, cd, eocd]);
}

const KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
  <Folder><name>Depots</name>
    <Placemark><name>Nairobi depot</name>
      <Point><coordinates>36.8219,-1.2921,0</coordinates></Point>
    </Placemark>
  </Folder>
</Document></kml>`;

describe('extensionOf / isSupportedImport', () => {
  it('is case-insensitive about the extension', () => {
    expect(extensionOf('Counties.KMZ')).toBe('.kmz');
    expect(isSupportedImport('Counties.KMZ')).toBe(true);
    expect(isSupportedImport('sites.CSV')).toBe(true);
    expect(isSupportedImport('notes.txt')).toBe(false);
    expect(isSupportedImport('no-extension')).toBe(false);
  });
});

describe('parseMapUpload', () => {
  it('reads a KMZ end to end: unzip, parse, categorise', () => {
    const result = parseMapUpload({ fileName: 'sites.kmz', bytes: kmz([{ name: 'doc.kml', text: KML }]) });
    expect(result.source).toBe('kmz');
    expect(result.features).toHaveLength(1);
    expect(result.features[0]).toMatchObject({
      name: 'Nairobi depot',
      category: 'Depots',
      geometry: { type: 'Point', coordinates: [36.8219, -1.2921] },
    });
  });

  it('falls back to the first .kml when the archive has no doc.kml', () => {
    const result = parseMapUpload({ fileName: 'sites.kmz', bytes: kmz([{ name: 'Sites.kml', text: KML }]) });
    expect(result.features).toHaveLength(1);
  });

  it('warns that KMZ icon images were not imported', () => {
    const bytes = kmz([
      { name: 'doc.kml', text: KML },
      { name: 'files/marker.png', text: 'not really a png' },
    ]);
    expect(parseMapUpload({ fileName: 'sites.kmz', bytes }).warnings.join(' ')).toMatch(/icon images/i);
  });

  it('rejects a KMZ with no KML inside', () => {
    const bytes = kmz([{ name: 'readme.txt', text: 'hello' }]);
    expect(() => parseMapUpload({ fileName: 'sites.kmz', bytes })).toThrow(/no \.kml/i);
  });

  it('reads a bare .kml with no zip wrapper', () => {
    const result = parseMapUpload({ fileName: 'sites.kml', bytes: Buffer.from(KML) });
    expect(result.source).toBe('kml');
    expect(result.features).toHaveLength(1);
  });

  it('reads a CSV and reports skipped rows', () => {
    const csv = 'Name,Latitude,Longitude,Type\nDepot,-1.29,36.82,Sites\nBroken,,\n';
    const result = parseMapUpload({ fileName: 'sites.csv', bytes: Buffer.from(csv) });
    expect(result.source).toBe('csv');
    expect(result.features).toHaveLength(1);
    expect(result.features[0].category).toBe('Sites');
    expect(result.skipped).toBe(1);
  });

  it('caps a very large file and says so', () => {
    const rows = ['lat,lon'];
    for (let i = 0; i < MAX_IMPORT_FEATURES + 25; i += 1) rows.push(`-1.${i % 100},36.8`);
    const result = parseMapUpload({ fileName: 'big.csv', bytes: Buffer.from(rows.join('\n')) });
    expect(result.features).toHaveLength(MAX_IMPORT_FEATURES);
    expect(result.warnings.join(' ')).toMatch(new RegExp(`first ${MAX_IMPORT_FEATURES}`));
  });

  it('refuses a file type it cannot read', () => {
    expect(() => parseMapUpload({ fileName: 'sites.gpx', bytes: Buffer.from('<gpx/>') })).toThrow(
      /Unsupported file type/,
    );
  });
});
