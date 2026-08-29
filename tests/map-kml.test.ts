import { describe, expect, it } from 'vitest';

import { kmlColor, kmlToFeatures, parseCoordinates } from '../lib/geo-kml';

const DOC = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Operations</name>
    <Style id="siteNormal">
      <LineStyle><color>ff0000ff</color><width>3</width></LineStyle>
      <PolyStyle><color>8000ff00</color></PolyStyle>
    </Style>
    <StyleMap id="siteMap">
      <Pair><key>normal</key><styleUrl>#siteNormal</styleUrl></Pair>
      <Pair><key>highlight</key><styleUrl>#other</styleUrl></Pair>
    </StyleMap>
    <Folder>
      <name>Checkpoints</name>
      <Placemark>
        <name>Gate A</name>
        <description><![CDATA[Main <b>entrance</b>]]></description>
        <ExtendedData>
          <Data name="radio"><value>CH-4</value></Data>
        </ExtendedData>
        <Point><coordinates>36.8219,-1.2921,1680</coordinates></Point>
      </Placemark>
    </Folder>
    <Folder>
      <name>Perimeter</name>
      <Placemark>
        <name>Compound</name>
        <styleUrl>#siteMap</styleUrl>
        <Polygon>
          <outerBoundaryIs><LinearRing><coordinates>
            36.80,-1.30 36.84,-1.30 36.84,-1.28 36.80,-1.28 36.80,-1.30
          </coordinates></LinearRing></outerBoundaryIs>
          <innerBoundaryIs><LinearRing><coordinates>
            36.81,-1.295 36.82,-1.295 36.82,-1.29 36.81,-1.29 36.81,-1.295
          </coordinates></LinearRing></innerBoundaryIs>
        </Polygon>
      </Placemark>
      <Placemark>
        <name>Patrol route</name>
        <ExtendedData>
          <SchemaData><SimpleData name="category">Routes</SimpleData></SchemaData>
        </ExtendedData>
        <MultiGeometry>
          <LineString><coordinates>36.80,-1.30 36.84,-1.28</coordinates></LineString>
          <Point><coordinates>36.82,-1.29</coordinates></Point>
        </MultiGeometry>
      </Placemark>
    </Folder>
  </Document>
</kml>`;

describe('parseCoordinates', () => {
  it('reads lng,lat[,alt] tuples and drops the altitude', () => {
    expect(parseCoordinates('36.8219,-1.2921,1680 37.0,-1.0')).toEqual([
      [36.8219, -1.2921],
      [37, -1],
    ]);
  });

  it('ignores blank and malformed tokens', () => {
    expect(parseCoordinates('  \n 36.8,-1.2 \n bogus 1,x ')).toEqual([[36.8, -1.2]]);
  });
});

describe('kmlColor', () => {
  it('converts aabbggrr to #rrggbb plus opacity', () => {
    expect(kmlColor('ff0000ff')).toEqual({ hex: '#ff0000', opacity: 1 });
    expect(kmlColor('8000ff00')).toEqual({ hex: '#00ff00', opacity: 128 / 255 });
  });

  it('rejects anything that is not eight hex digits', () => {
    expect(kmlColor('#f00')).toBeNull();
    expect(kmlColor('')).toBeNull();
  });
});

describe('kmlToFeatures', () => {
  const features = kmlToFeatures(DOC);

  it('flattens every placemark out of its folders', () => {
    expect(features.map((f) => f.name)).toEqual([
      'Gate A',
      'Compound',
      'Patrol route',
      'Patrol route',
    ]);
  });

  it('keeps GeoJSON [lng, lat] order for points', () => {
    const gate = features[0];
    expect(gate.geometry).toEqual({ type: 'Point', coordinates: [36.8219, -1.2921] });
  });

  it('reads CDATA descriptions and ExtendedData', () => {
    expect(features[0].description).toBe('Main <b>entrance</b>');
    expect(features[0].properties.radio).toBe('CH-4');
  });

  it('defaults the category to the containing folder', () => {
    expect(features[0].category).toBe('Checkpoints');
    expect(features[0].properties.folder).toBe('Checkpoints');
  });

  it('prefers an explicit category field over the folder name', () => {
    expect(features[2].category).toBe('Routes');
  });

  it('turns innerBoundaryIs into a hole ring', () => {
    const polygon = features[1].geometry;
    expect(polygon.type).toBe('Polygon');
    if (polygon.type !== 'Polygon') throw new Error('expected a polygon');
    expect(polygon.coordinates).toHaveLength(2);
    expect(polygon.coordinates[0][0]).toEqual([36.8, -1.3]);
    // Both rings arrive closed.
    for (const ring of polygon.coordinates) {
      expect(ring[0]).toEqual(ring[ring.length - 1]);
    }
  });

  it('resolves styleUrl through a StyleMap to the normal pair', () => {
    expect(features[1].style).toMatchObject({
      stroke: '#ff0000',
      strokeWidth: 3,
      fill: '#00ff00',
    });
  });

  it('emits one feature per child of a MultiGeometry', () => {
    expect(features[2].geometry.type).toBe('LineString');
    expect(features[3].geometry.type).toBe('Point');
    expect(features[3].name).toBe('Patrol route');
  });

  it('closes an unclosed outer ring', () => {
    const [feature] = kmlToFeatures(`<kml><Document><Placemark><Polygon><outerBoundaryIs>
      <LinearRing><coordinates>0,0 1,0 1,1</coordinates></LinearRing>
    </outerBoundaryIs></Polygon></Placemark></Document></kml>`);
    if (feature.geometry.type !== 'Polygon') throw new Error('expected a polygon');
    expect(feature.geometry.coordinates[0]).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ]);
  });

  it('returns nothing for a document with no placemarks', () => {
    expect(kmlToFeatures('<kml><Document><name>Empty</name></Document></kml>')).toEqual([]);
  });
});
