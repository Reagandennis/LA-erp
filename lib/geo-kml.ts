/**
 * KML → GeoJSON-shaped features.
 *
 * Covers what actually turns up in a KMZ exported from Google Earth or My Maps:
 * folders, placemarks, the four geometry kinds, shared styles reached through
 * `styleUrl`/`StyleMap`, and ExtendedData. A `MultiGeometry` becomes one feature
 * per child geometry rather than a GeoJSON GeometryCollection — the map renders
 * and styles them identically, and it keeps the stored geometry type simple.
 */

import type { GeoGeometry, Position, Ring } from './geo-geometry';
import type { MapStyle, ParsedFeature } from './map-types';
import { type XmlNode, child, children, findAll, parseXml, textOf } from './geo-xml';

/** Names of ExtendedData fields that we treat as the feature's category. */
const CATEGORY_KEYS = ['category', 'type', 'group', 'class'];

/**
 * KML colours are `aabbggrr` — alpha first and the RGB channels reversed
 * relative to CSS. Returns null for anything that is not eight hex digits.
 */
export function kmlColor(raw: string): { hex: string; opacity: number } | null {
  const value = raw.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{8}$/.test(value)) return null;
  const aa = value.slice(0, 2);
  const bb = value.slice(2, 4);
  const gg = value.slice(4, 6);
  const rr = value.slice(6, 8);
  return {
    hex: `#${rr}${gg}${bb}`.toLowerCase(),
    opacity: Number.parseInt(aa, 16) / 255,
  };
}

/** Parse a KML `<coordinates>` blob: whitespace-separated `lng,lat[,alt]` tuples. */
export function parseCoordinates(raw: string): Position[] {
  const out: Position[] = [];
  for (const token of raw.trim().split(/\s+/)) {
    if (!token) continue;
    const parts = token.split(',');
    if (parts.length < 2) continue;
    const lng = Number.parseFloat(parts[0]);
    const lat = Number.parseFloat(parts[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    out.push([lng, lat]);
  }
  return out;
}

function ringFrom(node: XmlNode | undefined): Ring | null {
  const ring = child(node, 'LinearRing');
  const coords = parseCoordinates(textOf(ring, 'coordinates'));
  if (coords.length < 3) return null;
  // GeoJSON wants a closed ring; KML usually supplies one, but not always.
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) coords.push([first[0], first[1]]);
  return coords;
}

function pointGeometry(node: XmlNode): GeoGeometry | null {
  const coords = parseCoordinates(textOf(node, 'coordinates'));
  return coords.length > 0 ? { type: 'Point', coordinates: coords[0] } : null;
}

function lineGeometry(node: XmlNode): GeoGeometry | null {
  const coords = parseCoordinates(textOf(node, 'coordinates'));
  return coords.length >= 2 ? { type: 'LineString', coordinates: coords } : null;
}

/** gx:Track carries a position per timestamp; the path through them is a line. */
function trackGeometry(node: XmlNode): GeoGeometry | null {
  const coords = children(node, 'coord')
    .map((c) => {
      const [lng, lat] = c.text.trim().split(/\s+/).map(Number);
      return Number.isFinite(lng) && Number.isFinite(lat) ? ([lng, lat] as Position) : null;
    })
    .filter((c): c is Position => c !== null);
  return coords.length >= 2 ? { type: 'LineString', coordinates: coords } : null;
}

function polygonGeometry(node: XmlNode): GeoGeometry | null {
  const outer = ringFrom(child(node, 'outerBoundaryIs'));
  if (!outer) return null;
  const rings: Ring[] = [outer];
  for (const inner of children(node, 'innerBoundaryIs')) {
    const hole = ringFrom(inner);
    if (hole) rings.push(hole);
  }
  return { type: 'Polygon', coordinates: rings };
}

/** Geometries in document order, so a MultiGeometry comes back as the author wrote it. */
function geometriesOf(node: XmlNode): GeoGeometry[] {
  const out: GeoGeometry[] = [];
  for (const element of node.children) {
    let geometry: GeoGeometry | null = null;
    if (element.name === 'Point') geometry = pointGeometry(element);
    else if (element.name === 'LineString') geometry = lineGeometry(element);
    else if (element.name === 'LinearRing') geometry = lineGeometry(element);
    else if (element.name === 'Track') geometry = trackGeometry(element);
    else if (element.name === 'Polygon') geometry = polygonGeometry(element);
    else if (element.name === 'MultiGeometry') {
      out.push(...geometriesOf(element));
      continue;
    }
    if (geometry) out.push(geometry);
  }
  return out;
}

function styleFrom(node: XmlNode | undefined): Partial<MapStyle> | null {
  if (!node) return null;
  const style: Partial<MapStyle> = {};

  const line = child(node, 'LineStyle');
  if (line) {
    const color = kmlColor(textOf(line, 'color'));
    if (color) style.stroke = color.hex;
    const width = Number.parseFloat(textOf(line, 'width'));
    if (Number.isFinite(width) && width > 0) style.strokeWidth = Math.min(12, Math.round(width));
  }

  const poly = child(node, 'PolyStyle');
  if (poly) {
    const color = kmlColor(textOf(poly, 'color'));
    if (color) {
      style.fill = color.hex;
      style.fillOpacity = color.opacity;
    }
    if (textOf(poly, 'fill') === '0') style.fillOpacity = 0;
  }

  // No LineStyle of its own — take the icon tint so points still read as themed.
  if (!style.stroke) {
    const icon = kmlColor(textOf(child(node, 'IconStyle'), 'color'));
    if (icon) style.stroke = icon.hex;
  }

  return Object.keys(style).length > 0 ? style : null;
}

/** Build the `#id` → style lookup, resolving `StyleMap` to its `normal` pair. */
function collectStyles(root: XmlNode): Map<string, Partial<MapStyle>> {
  const direct = new Map<string, Partial<MapStyle>>();
  for (const node of findAll(root, 'Style')) {
    const id = node.attrs.id;
    const style = styleFrom(node);
    if (id && style) direct.set(id, style);
  }

  const resolved = new Map(direct);
  for (const map of findAll(root, 'StyleMap')) {
    const id = map.attrs.id;
    if (!id) continue;
    for (const pair of children(map, 'Pair')) {
      if (textOf(pair, 'key') !== 'normal') continue;
      const ref = textOf(pair, 'styleUrl').replace(/^#/, '');
      const style = direct.get(ref) ?? styleFrom(child(pair, 'Style'));
      if (style) resolved.set(id, style);
    }
  }
  return resolved;
}

function extendedDataOf(placemark: XmlNode): Record<string, string> {
  const props: Record<string, string> = {};
  const extended = child(placemark, 'ExtendedData');
  if (!extended) return props;

  for (const data of children(extended, 'Data')) {
    const key = data.attrs.name;
    if (key) props[key] = textOf(data, 'value') || data.text.trim();
  }
  for (const schema of children(extended, 'SchemaData')) {
    for (const simple of children(schema, 'SimpleData')) {
      const key = simple.attrs.name;
      if (key) props[key] = simple.text.trim();
    }
  }
  return props;
}

function categoryOf(props: Record<string, string>, folder: string | null): string | null {
  for (const [key, value] of Object.entries(props)) {
    if (CATEGORY_KEYS.includes(key.toLowerCase()) && value.trim()) return value.trim();
  }
  return folder;
}

function placemarkToFeatures(
  placemark: XmlNode,
  styles: Map<string, Partial<MapStyle>>,
  folder: string | null,
): ParsedFeature[] {
  const geometries = geometriesOf(placemark);
  if (geometries.length === 0) return [];

  const name = textOf(placemark, 'name');
  const description = textOf(placemark, 'description');
  const props = extendedDataOf(placemark);
  if (folder) props.folder = folder;

  const ref = textOf(placemark, 'styleUrl').replace(/^#/, '');
  const style = styleFrom(child(placemark, 'Style')) ?? (ref ? styles.get(ref) ?? null : null);

  return geometries.map((geometry) => ({
    name,
    description: description || null,
    geometry,
    properties: props,
    category: categoryOf(props, folder),
    style,
  }));
}

/**
 * Every placemark in the document, flattened out of its folders. The containing
 * folder's name is kept as a `folder` property and used as the default category,
 * which is how most KMZ authors express grouping.
 */
export function kmlToFeatures(xml: string): ParsedFeature[] {
  const root = parseXml(xml);
  const styles = collectStyles(root);
  const out: ParsedFeature[] = [];

  const walk = (node: XmlNode, folder: string | null) => {
    for (const node2 of node.children) {
      if (node2.name === 'Placemark') {
        out.push(...placemarkToFeatures(node2, styles, folder));
      } else if (node2.name === 'Folder' || node2.name === 'Document') {
        walk(node2, textOf(node2, 'name') || folder);
      } else if (node2.children.length > 0) {
        walk(node2, folder);
      }
    }
  };

  walk(root, null);
  return out;
}
