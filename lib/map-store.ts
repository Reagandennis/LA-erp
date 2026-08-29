import 'server-only';

import { Prisma } from '@prisma/client';

import { boundsOf } from './geo-geometry';
import type { GeoGeometry, GeofenceGeometry } from './geo-geometry';
import { prisma } from './prisma';
import {
  BOUNDARY_STYLE,
  DEFAULT_STYLE,
  type CategoryScope,
  type GeofenceShape,
  type ImportSource,
  type LayerKind,
  type MapCategoryDto,
  type MapDeviceTagDto,
  type MapFeatureDto,
  type MapGeofenceDto,
  type MapLayerDto,
  type MapStyle,
  type MapWorkspaceDto,
  type ParsedFeature,
} from './map-types';

/** Colours handed out to categories created automatically during an import. */
const AUTO_CATEGORY_COLORS = [
  '#03458f',
  '#0f766e',
  '#b45309',
  '#9333ea',
  '#be123c',
  '#0369a1',
  '#4d7c0f',
  '#c2410c',
];

/** Postgres caps a statement's parameters, so wide inserts go in batches. */
const FEATURE_INSERT_CHUNK = 500;

const CATEGORY_SELECT = {
  id: true,
  name: true,
  color: true,
  icon: true,
  scope: true,
  sortOrder: true,
} as const;

/** Deliberately omits fileContent — layer lists must never drag the raw upload along. */
const LAYER_SELECT = {
  id: true,
  name: true,
  kind: true,
  source: true,
  fileName: true,
  fileSize: true,
  visible: true,
  sortOrder: true,
  categoryId: true,
  style: true,
  minLat: true,
  minLng: true,
  maxLat: true,
  maxLng: true,
  featureCount: true,
  createdAt: true,
} as const;

const FEATURE_SELECT = {
  id: true,
  layerId: true,
  categoryId: true,
  name: true,
  description: true,
  geometryType: true,
  geometry: true,
  properties: true,
  style: true,
  icon: true,
} as const;

const GEOFENCE_SELECT = {
  id: true,
  name: true,
  shape: true,
  geometry: true,
  style: true,
  visible: true,
  categoryId: true,
} as const;

const DEVICE_TAG_SELECT = {
  device: true,
  categoryId: true,
  icon: true,
  label: true,
  hidden: true,
} as const;

type CategoryRow = Prisma.MapCategoryGetPayload<{ select: typeof CATEGORY_SELECT }>;
type LayerRow = Prisma.MapLayerGetPayload<{ select: typeof LAYER_SELECT }>;
type FeatureRow = Prisma.MapFeatureGetPayload<{ select: typeof FEATURE_SELECT }>;
type GeofenceRow = Prisma.MapGeofenceGetPayload<{ select: typeof GEOFENCE_SELECT }>;
type DeviceTagRow = Prisma.MapDeviceTagGetPayload<{ select: typeof DEVICE_TAG_SELECT }>;

function styleFrom(value: Prisma.JsonValue | null, fallback: MapStyle): MapStyle {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  return { ...fallback, ...(value as Partial<MapStyle>) };
}

function partialStyleFrom(value: Prisma.JsonValue | null): Partial<MapStyle> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Partial<MapStyle>;
}

function serializeCategory(row: CategoryRow): MapCategoryDto {
  return { ...row, scope: row.scope as CategoryScope };
}

function serializeLayer(row: LayerRow): MapLayerDto {
  const isBoundary = row.kind === 'boundary';
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as LayerKind,
    source: (row.source as ImportSource | null) ?? null,
    fileName: row.fileName,
    fileSize: row.fileSize,
    visible: row.visible,
    sortOrder: row.sortOrder,
    categoryId: row.categoryId,
    style: styleFrom(row.style, isBoundary ? BOUNDARY_STYLE : DEFAULT_STYLE),
    featureCount: row.featureCount,
    bounds:
      row.minLat !== null && row.minLng !== null && row.maxLat !== null && row.maxLng !== null
        ? { south: row.minLat, west: row.minLng, north: row.maxLat, east: row.maxLng }
        : null,
    createdAt: row.createdAt.toISOString(),
  };
}

function serializeFeature(row: FeatureRow): MapFeatureDto {
  return {
    id: row.id,
    layerId: row.layerId,
    categoryId: row.categoryId,
    name: row.name,
    description: row.description,
    geometryType: row.geometryType,
    geometry: row.geometry as unknown as GeoGeometry,
    properties: (row.properties as Record<string, string> | null) ?? null,
    style: partialStyleFrom(row.style),
    icon: row.icon,
  };
}

function serializeGeofence(row: GeofenceRow): MapGeofenceDto {
  return {
    id: row.id,
    name: row.name,
    shape: row.shape as GeofenceShape,
    geometry: row.geometry as unknown as GeofenceGeometry,
    style: styleFrom(row.style, DEFAULT_STYLE),
    visible: row.visible,
    categoryId: row.categoryId,
  };
}

function serializeDeviceTag(row: DeviceTagRow): MapDeviceTagDto {
  return {
    device: row.device,
    categoryId: row.categoryId,
    icon: row.icon,
    label: row.label,
  };
}

export async function getMapWorkspace(): Promise<MapWorkspaceDto> {
  const [categories, layers, geofences, deviceTags] = await Promise.all([
    prisma.mapCategory.findMany({ select: CATEGORY_SELECT, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    prisma.mapLayer.findMany({ select: LAYER_SELECT, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
    prisma.mapGeofence.findMany({ select: GEOFENCE_SELECT, orderBy: [{ name: 'asc' }] }),
    prisma.mapDeviceTag.findMany({ select: DEVICE_TAG_SELECT, orderBy: [{ device: 'asc' }] }),
  ]);

  return {
    categories: categories.map(serializeCategory),
    layers: layers.map(serializeLayer),
    geofences: geofences.map(serializeGeofence),
    deviceTags: deviceTags.map(serializeDeviceTag),
  };
}

/* ---------------------------------------------------------------- categories */

export async function createCategory(
  input: { name: string; color: string; icon: string; scope: CategoryScope },
  userId: number,
): Promise<MapCategoryDto> {
  const name = input.name.trim();
  if (!name) throw new Error('A category needs a name.');

  const count = await prisma.mapCategory.count();
  const row = await prisma.mapCategory.create({
    data: { ...input, name, sortOrder: count, createdById: userId },
    select: CATEGORY_SELECT,
  });
  return serializeCategory(row);
}

export async function updateCategory(
  id: number,
  patch: Partial<{ name: string; color: string; icon: string; scope: CategoryScope; sortOrder: number }>,
): Promise<MapCategoryDto | null> {
  const data = { ...patch };
  if (data.name !== undefined) {
    data.name = data.name.trim();
    if (!data.name) throw new Error('A category needs a name.');
  }
  const row = await prisma.mapCategory
    .update({ where: { id }, data, select: CATEGORY_SELECT })
    .catch(() => null);
  return row ? serializeCategory(row) : null;
}

/** Features and devices survive: the FKs are SetNull, so they fall back to the default pin. */
export async function deleteCategory(id: number): Promise<boolean> {
  const row = await prisma.mapCategory.delete({ where: { id } }).catch(() => null);
  return row !== null;
}

/* -------------------------------------------------------------------- layers */

export async function createLayer(
  input: { name: string; categoryId?: number | null },
  userId: number,
): Promise<MapLayerDto> {
  const name = input.name.trim() || 'Untitled layer';
  const count = await prisma.mapLayer.count();
  const row = await prisma.mapLayer.create({
    data: {
      name,
      kind: 'drawn',
      categoryId: input.categoryId ?? null,
      sortOrder: count,
      createdById: userId,
    },
    select: LAYER_SELECT,
  });
  return serializeLayer(row);
}

export async function updateLayer(
  id: number,
  patch: Partial<{
    name: string;
    visible: boolean;
    sortOrder: number;
    categoryId: number | null;
    style: MapStyle;
  }>,
): Promise<MapLayerDto | null> {
  const data: Prisma.MapLayerUpdateInput = {};
  if (patch.name !== undefined) data.name = patch.name.trim() || 'Untitled layer';
  if (patch.visible !== undefined) data.visible = patch.visible;
  if (patch.sortOrder !== undefined) data.sortOrder = patch.sortOrder;
  if (patch.categoryId !== undefined) {
    data.category = patch.categoryId ? { connect: { id: patch.categoryId } } : { disconnect: true };
  }
  if (patch.style !== undefined) data.style = patch.style as unknown as Prisma.InputJsonValue;

  const row = await prisma.mapLayer
    .update({ where: { id }, data, select: LAYER_SELECT })
    .catch(() => null);
  return row ? serializeLayer(row) : null;
}

export async function deleteLayer(id: number): Promise<boolean> {
  const layer = await prisma.mapLayer.delete({ where: { id } }).catch(() => null);
  return layer !== null;
}

export async function getLayerFile(
  id: number,
): Promise<{ name: string; mime: string; content: Buffer } | null> {
  const row = await prisma.mapLayer.findUnique({
    where: { id },
    select: { fileName: true, fileMime: true, fileContent: true },
  });
  if (!row?.fileContent || !row.fileName) return null;
  return {
    name: row.fileName,
    mime: row.fileMime || 'application/octet-stream',
    content: Buffer.from(row.fileContent),
  };
}

/* ------------------------------------------------------------------ features */

export async function layerExists(id: number): Promise<boolean> {
  return (await prisma.mapLayer.count({ where: { id } })) > 0;
}

export async function listLayerFeatures(layerId: number): Promise<MapFeatureDto[]> {
  const rows = await prisma.mapFeature.findMany({
    where: { layerId },
    select: FEATURE_SELECT,
    orderBy: { id: 'asc' },
  });
  return rows.map(serializeFeature);
}

export async function createFeature(input: {
  layerId: number;
  name: string;
  description?: string | null;
  geometry: GeoGeometry;
  categoryId?: number | null;
  icon?: string | null;
  style?: Partial<MapStyle> | null;
}): Promise<MapFeatureDto> {
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.mapFeature.create({
      data: {
        layerId: input.layerId,
        name: input.name.trim(),
        description: input.description ?? null,
        geometryType: input.geometry.type,
        geometry: input.geometry as unknown as Prisma.InputJsonValue,
        categoryId: input.categoryId ?? null,
        icon: input.icon ?? null,
        style: (input.style ?? undefined) as Prisma.InputJsonValue | undefined,
      },
      select: FEATURE_SELECT,
    });
    await tx.mapLayer.update({
      where: { id: input.layerId },
      data: { featureCount: { increment: 1 } },
    });
    return created;
  });
  return serializeFeature(row);
}

export async function updateFeature(
  id: number,
  patch: Partial<{
    name: string;
    description: string | null;
    geometry: GeoGeometry;
    categoryId: number | null;
    icon: string | null;
    style: Partial<MapStyle> | null;
  }>,
): Promise<MapFeatureDto | null> {
  const data: Prisma.MapFeatureUpdateInput = {};
  if (patch.name !== undefined) data.name = patch.name.trim();
  if (patch.description !== undefined) data.description = patch.description;
  if (patch.geometry !== undefined) {
    data.geometry = patch.geometry as unknown as Prisma.InputJsonValue;
    data.geometryType = patch.geometry.type;
  }
  if (patch.categoryId !== undefined) {
    data.category = patch.categoryId ? { connect: { id: patch.categoryId } } : { disconnect: true };
  }
  if (patch.icon !== undefined) data.icon = patch.icon;
  if (patch.style !== undefined) {
    data.style = (patch.style ?? Prisma.DbNull) as Prisma.InputJsonValue;
  }

  const row = await prisma.mapFeature
    .update({ where: { id }, data, select: FEATURE_SELECT })
    .catch(() => null);
  return row ? serializeFeature(row) : null;
}

export async function deleteFeature(id: number): Promise<boolean> {
  const feature = await prisma.mapFeature.findUnique({ where: { id }, select: { layerId: true } });
  if (!feature) return false;
  await prisma.$transaction([
    prisma.mapFeature.delete({ where: { id } }),
    prisma.mapLayer.update({
      where: { id: feature.layerId },
      data: { featureCount: { decrement: 1 } },
    }),
  ]);
  return true;
}

/* ----------------------------------------------------------------- geofences */

export async function createGeofence(
  input: {
    name: string;
    shape: GeofenceShape;
    geometry: GeofenceGeometry;
    style?: MapStyle;
    categoryId?: number | null;
  },
  userId: number,
): Promise<MapGeofenceDto> {
  const row = await prisma.mapGeofence.create({
    data: {
      name: input.name.trim() || 'Untitled zone',
      shape: input.shape,
      geometry: input.geometry as unknown as Prisma.InputJsonValue,
      style: (input.style ?? DEFAULT_STYLE) as unknown as Prisma.InputJsonValue,
      categoryId: input.categoryId ?? null,
      createdById: userId,
    },
    select: GEOFENCE_SELECT,
  });
  return serializeGeofence(row);
}

export async function updateGeofence(
  id: number,
  patch: Partial<{
    name: string;
    geometry: GeofenceGeometry;
    style: MapStyle;
    visible: boolean;
    categoryId: number | null;
  }>,
): Promise<MapGeofenceDto | null> {
  const data: Prisma.MapGeofenceUpdateInput = {};
  if (patch.name !== undefined) data.name = patch.name.trim() || 'Untitled zone';
  if (patch.geometry !== undefined) {
    data.geometry = patch.geometry as unknown as Prisma.InputJsonValue;
  }
  if (patch.style !== undefined) data.style = patch.style as unknown as Prisma.InputJsonValue;
  if (patch.visible !== undefined) data.visible = patch.visible;
  if (patch.categoryId !== undefined) {
    data.category = patch.categoryId ? { connect: { id: patch.categoryId } } : { disconnect: true };
  }

  const row = await prisma.mapGeofence
    .update({ where: { id }, data, select: GEOFENCE_SELECT })
    .catch(() => null);
  return row ? serializeGeofence(row) : null;
}

export async function deleteGeofence(id: number): Promise<boolean> {
  const row = await prisma.mapGeofence.delete({ where: { id } }).catch(() => null);
  return row !== null;
}

/* --------------------------------------------------------------- device tags */

export async function upsertDeviceTag(
  device: string,
  patch: { categoryId?: number | null; icon?: string | null; label?: string | null },
): Promise<MapDeviceTagDto> {
  const row = await prisma.mapDeviceTag.upsert({
    where: { device },
    create: {
      device,
      categoryId: patch.categoryId ?? null,
      icon: patch.icon ?? null,
      label: patch.label ?? null,
    },
    update: patch,
    select: DEVICE_TAG_SELECT,
  });
  return serializeDeviceTag(row);
}

/* ------------------------------------------------------------------- imports */

/**
 * Match the category names carried by an imported file against existing
 * categories, creating any that are missing. Matching is case-insensitive so a
 * "Checkpoints" folder does not spawn a second category next to "checkpoints".
 */
async function resolveImportCategories(
  names: string[],
  userId: number,
): Promise<{ byName: Map<string, number>; created: string[] }> {
  const byName = new Map<string, number>();
  if (names.length === 0) return { byName, created: [] };

  const existing = await prisma.mapCategory.findMany({ select: { id: true, name: true } });
  for (const row of existing) byName.set(row.name.toLowerCase(), row.id);

  const created: string[] = [];
  let index = existing.length;
  for (const name of names) {
    const key = name.toLowerCase();
    if (byName.has(key)) continue;
    const row = await prisma.mapCategory.create({
      data: {
        name,
        color: AUTO_CATEGORY_COLORS[index % AUTO_CATEGORY_COLORS.length],
        icon: 'pin',
        scope: 'feature',
        sortOrder: index,
        createdById: userId,
      },
      select: { id: true },
    });
    byName.set(key, row.id);
    created.push(name);
    index += 1;
  }
  return { byName, created };
}

export interface ImportedLayerResult {
  layer: MapLayerDto;
  imported: number;
  categoriesCreated: string[];
}

export async function createLayerFromImport(
  input: {
    name: string;
    source: ImportSource;
    kind: LayerKind;
    fileName: string;
    fileMime: string;
    fileContent: Buffer;
    features: ParsedFeature[];
    categoryId: number | null;
  },
  userId: number,
): Promise<ImportedLayerResult> {
  const names = [...new Set(input.features.map((f) => f.category).filter((c): c is string => !!c))];
  const { byName, created } = await resolveImportCategories(names, userId);

  const bounds = boundsOf(input.features.map((f) => f.geometry));
  const count = await prisma.mapLayer.count();

  const layer = await prisma.mapLayer.create({
    data: {
      name: input.name.trim() || input.fileName,
      kind: input.kind,
      source: input.source,
      fileName: input.fileName,
      fileMime: input.fileMime,
      fileSize: input.fileContent.length,
      fileContent: input.fileContent,
      categoryId: input.categoryId,
      sortOrder: count,
      featureCount: input.features.length,
      minLat: bounds?.south ?? null,
      minLng: bounds?.west ?? null,
      maxLat: bounds?.north ?? null,
      maxLng: bounds?.east ?? null,
      style: (input.kind === 'boundary' ? BOUNDARY_STYLE : DEFAULT_STYLE) as unknown as Prisma.InputJsonValue,
      createdById: userId,
    },
    select: LAYER_SELECT,
  });

  for (let i = 0; i < input.features.length; i += FEATURE_INSERT_CHUNK) {
    const chunk = input.features.slice(i, i + FEATURE_INSERT_CHUNK);
    await prisma.mapFeature.createMany({
      data: chunk.map((feature) => ({
        layerId: layer.id,
        name: feature.name,
        description: feature.description,
        geometryType: feature.geometry.type,
        geometry: feature.geometry as unknown as Prisma.InputJsonValue,
        properties: (Object.keys(feature.properties).length > 0
          ? feature.properties
          : undefined) as Prisma.InputJsonValue | undefined,
        style: (feature.style ?? undefined) as Prisma.InputJsonValue | undefined,
        categoryId: feature.category ? byName.get(feature.category.toLowerCase()) ?? null : null,
      })),
    });
  }

  return {
    layer: serializeLayer(layer),
    imported: input.features.length,
    categoriesCreated: created,
  };
}
