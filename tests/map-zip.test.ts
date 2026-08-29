import { deflateRawSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { readZipEntries } from '../lib/geo-zip';

/** Build a real zip so the reader is exercised against the actual byte layout. */
function buildZip(
  entries: Array<{ name: string; content: Buffer; method: 0 | 8 }>,
  comment = '',
): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const stored = entry.method === 8 ? deflateRawSync(entry.content) : entry.content;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(entry.method, 8);
    local.writeUInt32LE(0, 14); // crc — the reader does not verify it
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(entry.content.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, stored);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(entry.method, 10);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(stored.length, 20);
    central.writeUInt32LE(entry.content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + stored.length;
  }

  const cd = Buffer.concat(centrals);
  const commentBytes = Buffer.from(comment, 'utf8');
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(commentBytes.length, 20);

  return Buffer.concat([...locals, cd, eocd, commentBytes]);
}

describe('readZipEntries', () => {
  it('reads a stored (uncompressed) entry', () => {
    const zip = buildZip([{ name: 'doc.kml', content: Buffer.from('<kml/>'), method: 0 }]);
    expect(readZipEntries(zip)).toEqual([{ name: 'doc.kml', data: Buffer.from('<kml/>') }]);
  });

  it('inflates a deflated entry', () => {
    // Repetitive content so deflate actually compresses and the two paths differ.
    const content = Buffer.from('<Placemark><name>Gate</name></Placemark>'.repeat(50));
    const zip = buildZip([{ name: 'doc.kml', content, method: 8 }]);
    const [entry] = readZipEntries(zip);
    expect(entry.name).toBe('doc.kml');
    expect(entry.data.toString()).toBe(content.toString());
  });

  it('reads every entry and skips directory markers', () => {
    const zip = buildZip([
      { name: 'files/', content: Buffer.alloc(0), method: 0 },
      { name: 'doc.kml', content: Buffer.from('a'), method: 0 },
      { name: 'files/icon.png', content: Buffer.from('b'), method: 8 },
    ]);
    expect(readZipEntries(zip).map((e) => e.name)).toEqual(['doc.kml', 'files/icon.png']);
  });

  it('still finds the EOCD when the archive carries a trailing comment', () => {
    const zip = buildZip([{ name: 'doc.kml', content: Buffer.from('x'), method: 0 }], 'made by tests');
    expect(readZipEntries(zip)).toHaveLength(1);
  });

  it('rejects a file that is not a zip', () => {
    expect(() => readZipEntries(Buffer.from('lat,lon\n1,2\n'))).toThrow(/not a zip archive/i);
  });

  it('rejects a truncated archive rather than returning junk', () => {
    const zip = buildZip([{ name: 'doc.kml', content: Buffer.from('hello'), method: 0 }]);
    const truncated = Buffer.concat([zip.subarray(0, 20), zip.subarray(zip.length - 22)]);
    expect(() => readZipEntries(truncated)).toThrow();
  });
});
