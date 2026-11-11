import 'server-only';

import { prisma } from './prisma';
import type { DayLogKind, ResourceResolution } from './trip-resource-model';
import { unverifiedResources, verificationNotice } from './trip-resource-model';
import { type TripDetail, getEditableTrip, getTripDetail } from './trips';

/**
 * A trip's resource pool: services staged from approved vendors' catalogs,
 * which events then pick from; the daily shift and odometer log; and the
 * check, before the trip completes, of anything staged that no event used.
 * Every write goes through the same "may this user change the trip" rule as
 * the itinerary, and hands back the whole trip like the itinerary routes do.
 */

type Result<T = TripDetail> = T | { error: string; status: number };

interface Actor {
  tripId: number;
  userId: number;
  isAdmin: boolean;
}

async function fresh(tripId: number): Promise<TripDetail> {
  return (await getTripDetail(tripId))!;
}

export interface StageInput {
  vendorId: number;
  productId: number;
  startDate?: string | null;
  endDate?: string | null;
  quantity: number;
}

/** Stages one service from an approved vendor's catalog into the trip's pool. */
export async function stageTripResource(params: Actor & { input: StageInput }): Promise<Result> {
  const guard = await getEditableTrip({ id: params.tripId, userId: params.userId, isAdmin: params.isAdmin });
  if ('error' in guard) return guard;

  const { input } = params;
  const offer = await prisma.vendorService.findUnique({
    where: { vendorId_productId: { vendorId: input.vendorId, productId: input.productId } },
    select: {
      vendor: { select: { name: true, status: true } },
      product: {
        select: { name: true, sku: true, category: true, serviceClass: true, unitOfMeasure: true, archived: true },
      },
    },
  });
  if (!offer) return { error: "That service is not in the vendor's catalog", status: 400 };
  if (offer.vendor.status !== 'Approved') return { error: `${offer.vendor.name} is not an approved vendor`, status: 400 };
  if (offer.product.archived) return { error: 'That service has been archived in Products & Services', status: 400 };

  await prisma.tripResource.create({
    data: {
      tripId: params.tripId,
      vendorId: input.vendorId,
      productId: input.productId,
      // Copies: the pool and the billing log read the same if the catalog changes later.
      vendorName: offer.vendor.name,
      serviceName: offer.product.name,
      serviceCode: offer.product.sku,
      category: offer.product.category,
      serviceClass: offer.product.serviceClass,
      unitOfMeasure: offer.product.unitOfMeasure,
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
      quantity: input.quantity,
      createdById: params.userId,
    },
  });
  return fresh(params.tripId);
}

export interface ResourceUpdateInput {
  startDate?: string | null;
  endDate?: string | null;
  quantity?: number;
  /** Null takes back a verdict given at reconciliation. */
  resolution?: null;
}

export async function updateTripResource(params: Actor & { resourceId: number; input: ResourceUpdateInput }): Promise<Result> {
  const guard = await getEditableTrip({ id: params.tripId, userId: params.userId, isAdmin: params.isAdmin });
  if ('error' in guard) return guard;
  const resource = guard.trip.resources.find((candidate) => candidate.id === params.resourceId);
  if (!resource) return { error: 'That resource is not in this trip\'s pool', status: 404 };

  const { input } = params;
  const startDate = input.startDate === undefined ? resource.startDate : input.startDate;
  const endDate = input.endDate === undefined ? resource.endDate : input.endDate;
  if (startDate && endDate && endDate < startDate) return { error: 'The end date is before the start date', status: 400 };

  await prisma.tripResource.update({
    where: { id: params.resourceId },
    data: {
      startDate,
      endDate,
      quantity: input.quantity,
      ...(input.resolution === null
        ? { resolution: null, billableHours: null, startOdometer: null, endOdometer: null, resolvedAt: null, resolvedById: null }
        : {}),
    },
  });
  return fresh(params.tripId);
}

/** Takes a service out of the pool. Events that used it keep its name, as text. */
export async function removeTripResource(params: Actor & { resourceId: number }): Promise<Result> {
  const guard = await getEditableTrip({ id: params.tripId, userId: params.userId, isAdmin: params.isAdmin });
  if ('error' in guard) return guard;
  if (!guard.trip.resources.some((candidate) => candidate.id === params.resourceId)) {
    return { error: 'That resource is not in this trip\'s pool', status: 404 };
  }
  await prisma.tripResource.delete({ where: { id: params.resourceId } });
  return fresh(params.tripId);
}

export interface ResourceVerdict {
  resourceId: number;
  resolution: ResourceResolution;
  billableHours?: number | null;
  startOdometer?: number | null;
  endOdometer?: number | null;
}

export interface ReconcileOutcome {
  trip: TripDetail;
  /** Verdicts saved (one for a resource an event has since picked up is skipped). */
  resolved: number;
  /** The trip moved to Completed with this call. */
  completed: boolean;
  previousStatus: string;
}

/**
 * Saves the Controller's verdicts on staged resources no event used, and,
 * when asked, completes the trip in the same transaction. The trip only
 * completes once nothing is left unverified, so billing never closes on a
 * resource nobody has accounted for.
 */
export async function reconcileTripResources(
  params: Actor & { verdicts: ResourceVerdict[]; complete: boolean },
): Promise<Result<ReconcileOutcome>> {
  const guard = await getEditableTrip({ id: params.tripId, userId: params.userId, isAdmin: params.isAdmin });
  if ('error' in guard) return guard;
  const { trip } = guard;

  const pool = new Map(trip.resources.map((resource) => [resource.id, resource]));
  if (params.verdicts.some((verdict) => !pool.has(verdict.resourceId))) {
    return { error: 'One of those resources is no longer in this trip\'s pool', status: 400 };
  }
  const assigned = new Set(trip.items.flatMap((item) => item.resourceIds));
  // An event picked it up since the dialog opened: it is used, and needs no verdict.
  const verdicts = params.verdicts.filter((verdict) => !assigned.has(verdict.resourceId));

  const decided = new Map(verdicts.map((verdict) => [verdict.resourceId, verdict.resolution]));
  const after = trip.resources.map((resource) => ({ ...resource, resolution: decided.get(resource.id) ?? resource.resolution }));
  const pending = unverifiedResources(after, trip.items);
  const completing = params.complete && trip.status !== 'Completed';
  if (completing && pending.length > 0) {
    return { error: `${verificationNotice(pending.length)} before this trip can be completed`, status: 409 };
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    for (const verdict of verdicts) {
      const used = verdict.resolution === 'used';
      await tx.tripResource.update({
        where: { id: verdict.resourceId },
        data: {
          resolution: verdict.resolution,
          billableHours: used ? (verdict.billableHours ?? null) : null,
          startOdometer: used ? (verdict.startOdometer ?? null) : null,
          endOdometer: used ? (verdict.endOdometer ?? null) : null,
          resolvedAt: now,
          resolvedById: params.userId,
        },
      });
    }
    if (completing) await tx.trip.update({ where: { id: params.tripId }, data: { status: 'Completed' } });
  });

  return { trip: await fresh(params.tripId), resolved: verdicts.length, completed: completing, previousStatus: trip.status };
}

export interface DayLogInput {
  kind: DayLogKind;
  /** The driver's, CPO's or vehicle's id in its register. */
  subjectId: number;
  shiftStart?: string | null;
  shiftEnd?: string | null;
  startOdometer?: number | null;
  endOdometer?: number | null;
}

const SUBJECT_COLUMN = { driver: 'driverId', officer: 'officerId', vehicle: 'vehicleId' } as const;

async function subjectLabel(kind: DayLogKind, id: number): Promise<string | null> {
  if (kind === 'vehicle') {
    return (await prisma.vehicle.findUnique({ where: { id }, select: { registration: true } }))?.registration ?? null;
  }
  const row =
    kind === 'driver'
      ? await prisma.driver.findUnique({ where: { id }, select: { name: true } })
      : await prisma.officer.findUnique({ where: { id }, select: { name: true } });
  return row?.name ?? null;
}

/**
 * One person's shift times, or one vehicle's odometer readings, for one day
 * of the trip. The whole line is sent each time; a line with nothing left on
 * it is removed. People carry times and vehicles carry readings, never both.
 */
export async function saveTripDayLog(params: Actor & { dayId: number; input: DayLogInput }): Promise<Result> {
  const guard = await getEditableTrip({ id: params.tripId, userId: params.userId, isAdmin: params.isAdmin });
  if ('error' in guard) return guard;
  if (!guard.trip.days.some((day) => day.id === params.dayId)) return { error: 'Day not found on this trip', status: 404 };

  const { input } = params;
  const vehicle = input.kind === 'vehicle';
  const values = {
    shiftStart: vehicle ? null : (input.shiftStart ?? null),
    shiftEnd: vehicle ? null : (input.shiftEnd ?? null),
    startOdometer: vehicle ? (input.startOdometer ?? null) : null,
    endOdometer: vehicle ? (input.endOdometer ?? null) : null,
  };
  const empty = Object.values(values).every((value) => value === null);

  const column = SUBJECT_COLUMN[input.kind];
  const existing = await prisma.tripDayLog.findFirst({
    where: { dayId: params.dayId, [column]: input.subjectId },
    select: { id: true },
  });

  if (existing && empty) {
    await prisma.tripDayLog.delete({ where: { id: existing.id } });
  } else if (existing) {
    await prisma.tripDayLog.update({ where: { id: existing.id }, data: { ...values, updatedById: params.userId } });
  } else if (!empty) {
    const label = await subjectLabel(input.kind, input.subjectId);
    if (!label) {
      return { error: `That ${vehicle ? 'vehicle' : input.kind === 'driver' ? 'driver' : 'CPO'} is no longer on the register`, status: 400 };
    }
    await prisma.tripDayLog.create({
      data: {
        tripId: params.tripId,
        dayId: params.dayId,
        kind: input.kind,
        [column]: input.subjectId,
        label,
        ...values,
        updatedById: params.userId,
      },
    });
  }
  return fresh(params.tripId);
}
