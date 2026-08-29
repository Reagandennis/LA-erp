import type { MapCategoryDto, TrackedDevice } from '@/lib/map-types';

/**
 * Roster search.
 *
 * Every whitespace-separated word must match somewhere, so "eth 01" finds
 * "ETH 01" without also returning every other ETH unit. Matching covers the
 * name, the tracker's unique id (IMEI), its category and its source, because
 * those are what an operator actually knows about a vehicle.
 */

export function searchTokens(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * A short numeric token like "01" occurs inside almost every IMEI, so searching
 * "eth 01" would otherwise return every ETH unit. Unique ids are only consulted
 * for tokens long enough to be a deliberate id search.
 */
const MIN_ID_TOKEN_LENGTH = 4;

function describe(
  device: TrackedDevice,
  categories: Record<number, MapCategoryDto>,
  categoryId: number | null | undefined,
): string {
  const category = categoryId != null ? categories[categoryId]?.name : undefined;
  return [device.name, category, device.source].filter(Boolean).join(' ').toLowerCase();
}

export function matchesDevice(
  device: TrackedDevice,
  tokens: string[],
  categories: Record<number, MapCategoryDto>,
  categoryId: number | null | undefined,
): boolean {
  if (tokens.length === 0) return true;
  const text = describe(device, categories, categoryId);
  const uniqueId = (device.uniqueId ?? '').toLowerCase();
  return tokens.every(
    (token) =>
      text.includes(token) ||
      (token.length >= MIN_ID_TOKEN_LENGTH && uniqueId.includes(token)),
  );
}

export function filterDevices(
  devices: TrackedDevice[],
  query: string,
  categories: Record<number, MapCategoryDto>,
  categoryIdOf: (device: TrackedDevice) => number | null | undefined,
): TrackedDevice[] {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return devices;
  return devices.filter((device) => matchesDevice(device, tokens, categories, categoryIdOf(device)));
}
