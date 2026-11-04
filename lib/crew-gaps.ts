/**
 * Which of a movement's crew are still to be assigned. A flight (the meet and
 * transfer) and a ground movement are crewed by a driver, a vehicle and a
 * Close Protection Officer, none of which the form insists on: a gap is
 * something the desk is told about, not something that stops the event
 * being planned. Pure: the server, the ops board and tests share it.
 */

export const CREWED_CATEGORIES = ['flight', 'transportation'] as const;

export type CrewRole = 'driver' | 'vehicle' | 'CPO';

export function isCrewedCategory(category: string | null | undefined): boolean {
  return (CREWED_CATEGORIES as readonly string[]).includes(category ?? '');
}

function typed(details: unknown, key: string): boolean {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return false;
  const value = (details as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * The roles missing on an event, in the order they are shown. An imported
 * record that names its driver or vehicle as text counts as having them.
 * Nothing for events that take no crew.
 */
export function crewGaps(item: {
  category?: string | null;
  driverId?: number | null;
  officerId?: number | null;
  vehicleId?: number | null;
  details?: unknown;
}): CrewRole[] {
  if (!isCrewedCategory(item.category)) return [];
  const gaps: CrewRole[] = [];
  if (!item.driverId && !typed(item.details, 'driverName')) gaps.push('driver');
  if (!item.vehicleId && !typed(item.details, 'vehicle')) gaps.push('vehicle');
  if (!item.officerId) gaps.push('CPO');
  return gaps;
}

/** "No driver, vehicle or CPO assigned", "No CPO assigned"; "" when fully crewed. */
export function crewGapLabel(gaps: readonly CrewRole[]): string {
  if (gaps.length === 0) return '';
  const list = gaps.length === 1 ? gaps[0] : `${gaps.slice(0, -1).join(', ')} or ${gaps[gaps.length - 1]}`;
  return `No ${list} assigned`;
}
