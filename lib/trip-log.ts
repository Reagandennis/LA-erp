import 'server-only';

import { prisma } from './prisma';

export interface TripLogEntryDto {
  id: number;
  loggedAt: string;
  detail: string;
  receivedFrom: string | null;
  actionItem: string | null;
  dutyController: string | null;
  comments: string | null;
  escalated: boolean;
  createdBy: { id: number; name: string } | null;
  createdAt: string;
}

const entrySelect = {
  id: true,
  loggedAt: true,
  detail: true,
  receivedFrom: true,
  actionItem: true,
  dutyController: true,
  comments: true,
  escalated: true,
  createdAt: true,
  createdBy: { select: { id: true, name: true } },
} as const;

function serialize(row: {
  id: number;
  loggedAt: Date;
  detail: string;
  receivedFrom: string | null;
  actionItem: string | null;
  dutyController: string | null;
  comments: string | null;
  escalated: boolean;
  createdAt: Date;
  createdBy: { id: number; name: string } | null;
}): TripLogEntryDto {
  return { ...row, loggedAt: row.loggedAt.toISOString(), createdAt: row.createdAt.toISOString() };
}

/**
 * The same rule as viewing the trip (lib/trips.ts getTripForUser): admins, the
 * creator and the owner. Anyone who can see a trip can add to its log.
 */
async function canAccessTrip(tripId: number, userId: number, isAdmin: boolean): Promise<boolean> {
  const trip = await prisma.trip.findUnique({ where: { id: tripId }, select: { createdById: true, ownerId: true } });
  if (!trip) return false;
  return isAdmin || trip.createdById === userId || trip.ownerId === userId;
}

export async function listTripLog(params: {
  tripId: number;
  userId: number;
  isAdmin: boolean;
}): Promise<TripLogEntryDto[] | null> {
  if (!(await canAccessTrip(params.tripId, params.userId, params.isAdmin))) return null;
  const rows = await prisma.tripLogEntry.findMany({
    where: { tripId: params.tripId },
    orderBy: [{ loggedAt: 'asc' }, { id: 'asc' }],
    select: entrySelect,
  });
  return rows.map(serialize);
}

export async function addTripLogEntry(params: {
  tripId: number;
  userId: number;
  userName: string;
  isAdmin: boolean;
  input: {
    detail: string;
    receivedFrom?: string | null;
    actionItem?: string | null;
    comments?: string | null;
    escalated?: boolean;
    loggedAt?: string | null;
  };
}): Promise<TripLogEntryDto | null> {
  if (!(await canAccessTrip(params.tripId, params.userId, params.isAdmin))) return null;
  const { input } = params;
  const row = await prisma.tripLogEntry.create({
    data: {
      tripId: params.tripId,
      loggedAt: input.loggedAt ? new Date(input.loggedAt) : new Date(),
      detail: input.detail,
      receivedFrom: input.receivedFrom || null,
      actionItem: input.actionItem || null,
      comments: input.comments || null,
      escalated: input.escalated ?? false,
      // Whoever records it is the controller on duty.
      dutyController: params.userName,
      createdById: params.userId,
    },
    select: entrySelect,
  });
  return serialize(row);
}

/** Authors may remove their own entries; admins any. Imported entries have no author. */
export async function deleteTripLogEntry(params: {
  tripId: number;
  entryId: number;
  userId: number;
  isAdmin: boolean;
}): Promise<'deleted' | 'not-found' | 'forbidden'> {
  const entry = await prisma.tripLogEntry.findUnique({
    where: { id: params.entryId },
    select: { tripId: true, createdById: true },
  });
  if (!entry || entry.tripId !== params.tripId) return 'not-found';
  if (!(await canAccessTrip(params.tripId, params.userId, params.isAdmin))) return 'not-found';
  if (!params.isAdmin && entry.createdById !== params.userId) return 'forbidden';
  await prisma.tripLogEntry.delete({ where: { id: params.entryId } });
  return 'deleted';
}
