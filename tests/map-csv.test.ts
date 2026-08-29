import { describe, expect, it } from 'vitest';

import { csvToFeatures, parseCsv } from '../lib/geo-csv';

describe('parseCsv', () => {
  it('reads quoted fields containing the delimiter', () => {
    expect(parseCsv('name,lat\n"Gate A, north",-1.29\n')).toEqual([
      ['name', 'lat'],
      ['Gate A, north', '-1.29'],
    ]);
  });

  it('reads quoted fields containing newlines', () => {
    expect(parseCsv('name,note\n"A","line one\nline two"\n')).toEqual([
      ['name', 'note'],
      ['A', 'line one\nline two'],
    ]);
  });

  it('unescapes doubled quotes', () => {
    expect(parseCsv('name\n"He said ""go"""\n')).toEqual([['name'], ['He said "go"']]);
  });

  it('handles CRLF line endings and a UTF-8 BOM', () => {
    expect(parseCsv('﻿lat,lon\r\n1,2\r\n')).toEqual([
      ['lat', 'lon'],
      ['1', '2'],
    ]);
  });

  it('sniffs a semicolon-delimited file', () => {
    expect(parseCsv('name;lat;lon\nGate;-1.29;36.82\n')).toEqual([
      ['name', 'lat', 'lon'],
      ['Gate', '-1.29', '36.82'],
    ]);
  });

  it('does not emit a phantom row for the trailing newline', () => {
    expect(parseCsv('a,b\n1,2\n')).toHaveLength(2);
  });
});

describe('csvToFeatures', () => {
  it('detects each latitude/longitude header alias', () => {
    for (const [latHeader, lngHeader] of [
      ['lat', 'lon'],
      ['Latitude', 'Longitude'],
      ['LAT', 'LNG'],
      ['Y', 'X'],
      ['Lat (DD)', 'Long'],
    ]) {
      const { features } = csvToFeatures(`${latHeader},${lngHeader}\n-1.2921,36.8219\n`);
      expect(features, `${latHeader}/${lngHeader}`).toHaveLength(1);
      expect(features[0].geometry).toEqual({ type: 'Point', coordinates: [36.8219, -1.2921] });
    }
  });

  it('picks up name, category and description columns', () => {
    const { features } = csvToFeatures(
      'Name,Latitude,Longitude,Type,Notes\nGate A,-1.29,36.82,Checkpoint,Main entrance\n',
    );
    expect(features[0]).toMatchObject({
      name: 'Gate A',
      category: 'Checkpoint',
      description: 'Main entrance',
    });
  });

  it('keeps unrecognised columns as properties under their original header', () => {
    const { features } = csvToFeatures('lat,lon,Radio Channel\n-1.29,36.82,CH-4\n');
    expect(features[0].properties).toEqual({ 'Radio Channel': 'CH-4' });
  });

  it('skips unusable rows instead of failing the import', () => {
    const { features, skipped, warnings } = csvToFeatures(
      'name,lat,lon\nGood,-1.29,36.82\nNoCoords,,\nBadText,abc,36.82\nOutOfRange,120,36.82\n',
    );
    expect(features.map((f) => f.name)).toEqual(['Good']);
    expect(skipped).toBe(3);
    expect(warnings[0]).toBe('3 rows had no usable coordinates and were skipped.');
  });

  it('says "1 row ... was skipped" rather than mangling the singular', () => {
    const { warnings } = csvToFeatures('lat,lon\n-1.29,36.82\nbad,bad\n');
    expect(warnings[0]).toBe('1 row had no usable coordinates and was skipped.');
  });

  it('reads a hemisphere suffix', () => {
    const { features } = csvToFeatures('lat,lon\n1.2921 S,36.8219 E\n');
    expect(features[0].geometry).toEqual({ type: 'Point', coordinates: [36.8219, -1.2921] });
  });

  it('names an unnamed row after its line number', () => {
    const { features } = csvToFeatures('lat,lon\n-1.29,36.82\n');
    expect(features[0].name).toBe('Row 1');
  });

  it('reports a file with no coordinate columns rather than throwing', () => {
    const { features, warnings } = csvToFeatures('name,phone\nGate,123\n');
    expect(features).toEqual([]);
    expect(warnings[0]).toMatch(/latitude\/longitude/i);
  });

  it('reports an empty file', () => {
    expect(csvToFeatures('').warnings[0]).toMatch(/empty/i);
  });
});
