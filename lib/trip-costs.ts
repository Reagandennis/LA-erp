import 'server-only';

import { ADMIN_ROLE_NAME } from './rbac';
import type { TripDetail } from './trips';
import { type AccessUser, userHasModule, userHasRole } from './user';

/**
 * Item costs on a trip are the prices copied from the quote it was built from,
 * so only people who can work with quotes (and admins) see or change them.
 * Everyone else gets the itinerary without the money.
 */
export function canSeeTripCosts(user: AccessUser): boolean {
  return userHasRole(user, ADMIN_ROLE_NAME) || userHasModule(user, 'quotes');
}

/** The trip as this viewer may see it. Every route returning a trip goes through here. */
export function tripForViewer(trip: TripDetail, user: AccessUser): TripDetail {
  if (canSeeTripCosts(user)) return { ...trip, costsHidden: false };
  return { ...trip, costsHidden: true, items: trip.items.map((item) => ({ ...item, unitPrice: null })) };
}
