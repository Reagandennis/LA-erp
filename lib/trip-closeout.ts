import 'server-only';

import { prisma } from './prisma';
import { ADMIN_ROLE_NAME } from './rbac';
import { CLOSEOUT_CHECK_KEYS, type CloseoutCheckKey, allChecksConfirmed } from './trip-closeout-checks';
import { type AccessUser, userHasModule, userHasRole } from './user';

/**
 * Close-out is the verification step after a trip is completed. It has its own
 * grant (the "Trip Close Out" module) so verifiers needn't be the trip's
 * planners: they see every completed trip, not only the ones they run.
 */
export function canCloseOutTrips(user: AccessUser): boolean {
  return userHasRole(user, ADMIN_ROLE_NAME) || userHasModule(user, 'trip-closeout');
}

export interface TripCloseoutDto {
  checks: CloseoutCheckKey[];
  summary: string | null;
  issues: string | null;
  clientFeedback: string | null;
  /** Null while the close-out is still open. */
  closedAt: string | null;
  closedBy: { id: number; name: string } | null;
  updatedAt: string;
  updatedBy: { id: number; name: string } | null;
}

/** A trip on the Close out tab: completed, or closed out (which keeps it there). */
export interface CloseoutTripDto {
  id: number;
  reference: string;
  trackingCode: string;
  title: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  customer: { name: string; company: string | null };
  /** Lead first. */
  travelers: string[];
  owner: { id: number; name: string } | null;
  itemCount: number;
  logCount: number;
  /** The viewer may open the itinerary page (the rule in lib/trips.ts getTripForUser). */
  canOpen: boolean;
  closeout: TripCloseoutDto | null;
}

const closeoutSelect = {
  checks: true,
  summary: true,
  issues: true,
  clientFeedback: true,
  closedAt: true,
  updatedAt: true,
  closedBy: { select: { id: true, name: true } },
  updatedBy: { select: { id: true, name: true } },
} as const;

function serializeCloseout(row: {
  checks: string[];
  summary: string | null;
  issues: string | null;
  clientFeedback: string | null;
  closedAt: Date | null;
  updatedAt: Date;
  closedBy: { id: number; name: string } | null;
  updatedBy: { id: number; name: string } | null;
}): TripCloseoutDto {
  return {
    ...row,
    // A key dropped from CLOSEOUT_CHECKS no longer counts.
    checks: CLOSEOUT_CHECK_KEYS.filter((key) => row.checks.includes(key)),
    closedAt: row.closedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * How many completed trips still await close-out: the badge on the Trips
 * screen's tab, so the screen can open without loading the whole close-out list.
 */
export async function countPendingCloseouts(): Promise<number> {
  return prisma.trip.count({
    where: { status: 'Completed', OR: [{ closeout: null }, { closeout: { closedAt: null } }] },
  });
}

export async function listCloseoutTrips(user: AccessUser): Promise<CloseoutTripDto[]> {
  const isAdmin = userHasRole(user, ADMIN_ROLE_NAME);
  const canPlan = isAdmin || userHasModule(user, 'trip-planning');
  const rows = await prisma.trip.findMany({
    where: { OR: [{ status: 'Completed' }, { closeout: { closedAt: { not: null } } }] },
    orderBy: [{ endDate: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
    select: {
      id: true,
      reference: true,
      trackingCode: true,
      title: true,
      status: true,
      startDate: true,
      endDate: true,
      createdById: true,
      customer: { select: { name: true, company: true } },
      travelers: {
        select: { traveler: { select: { name: true } } },
        orderBy: [{ isPrimary: 'desc' }, { id: 'asc' }],
      },
      owner: { select: { id: true, name: true } },
      closeout: { select: closeoutSelect },
      _count: { select: { items: true, logEntries: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    reference: row.reference,
    trackingCode: row.trackingCode,
    title: row.title,
    status: row.status,
    startDate: row.startDate?.toISOString() ?? null,
    endDate: row.endDate?.toISOString() ?? null,
    customer: row.customer,
    travelers: row.travelers.map((link) => link.traveler.name),
    owner: row.owner,
    itemCount: row._count.items,
    logCount: row._count.logEntries,
    canOpen: canPlan && (isAdmin || row.createdById === user.id || row.owner?.id === user.id),
    closeout: row.closeout ? serializeCloseout(row.closeout) : null,
  }));
}

export interface CloseoutSaveInput {
  checks: CloseoutCheckKey[];
  summary?: string | null;
  issues?: string | null;
  clientFeedback?: string | null;
  /** Close it out (every check must be confirmed), or leave / put it back open. */
  closed: boolean;
}

export type CloseoutSaveResult =
  | {
      closeout: TripCloseoutDto;
      reference: string;
      wasClosed: boolean;
      /** Fields this save changed, for the audit trail. */
      changed: string[];
    }
  | { error: string; status: number };

/**
 * Saves the whole close-out. Only a completed trip can be closed out, but once
 * it is, it stays editable whatever happens to the trip's status; reopening
 * it is the one way back.
 */
export async function saveTripCloseout(params: {
  tripId: number;
  userId: number;
  input: CloseoutSaveInput;
}): Promise<CloseoutSaveResult> {
  const trip = await prisma.trip.findUnique({
    where: { id: params.tripId },
    select: {
      reference: true,
      status: true,
      closeout: {
        select: { checks: true, summary: true, issues: true, clientFeedback: true, closedAt: true, closedById: true },
      },
    },
  });
  if (!trip) return { error: 'Trip not found', status: 404 };

  const previous = trip.closeout;
  const wasClosed = Boolean(previous?.closedAt);
  if (trip.status !== 'Completed' && !wasClosed) {
    return { error: 'Only completed trips can be closed out', status: 400 };
  }

  const { input } = params;
  const checks = CLOSEOUT_CHECK_KEYS.filter((key) => input.checks.includes(key));
  if (input.closed && !allChecksConfirmed(checks)) {
    return { error: 'Confirm every check before closing out', status: 400 };
  }

  const data = {
    checks,
    summary: input.summary || null,
    issues: input.issues || null,
    clientFeedback: input.clientFeedback || null,
    // Editing a closed-out trip keeps who closed it and when.
    closedAt: input.closed ? (previous?.closedAt ?? new Date()) : null,
    closedById: input.closed ? (wasClosed ? previous!.closedById : params.userId) : null,
    updatedById: params.userId,
  };

  const changed: string[] = [];
  if ((previous?.checks ?? []).join() !== checks.join()) changed.push('checks');
  for (const field of ['summary', 'issues', 'clientFeedback'] as const) {
    if ((previous?.[field] ?? null) !== data[field]) changed.push(field);
  }
  if (wasClosed !== input.closed) changed.push('closed');

  const row = await prisma.tripCloseout.upsert({
    where: { tripId: params.tripId },
    create: { tripId: params.tripId, ...data },
    update: data,
    select: closeoutSelect,
  });

  return { closeout: serializeCloseout(row), reference: trip.reference, wasClosed, changed };
}
