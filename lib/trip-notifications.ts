import { APP_LOCALE } from './locale';
import 'server-only';

import { Prisma } from '@prisma/client';

import { type CrewRole, crewGapLabel } from './crew-gaps';
import { notifyNotificationsChanged } from './notification-events';
import { prisma } from './prisma';

/** A movement saved with a driver, vehicle or CPO still to assign. */
export const CREW_GAP_TYPE = 'trip.item.crew-gap';

export interface TripItineraryItemNotificationSummary {
  id: number;
  itemId: number;
  tripId: number;
  type: string;
  message: string;
  createdAt: string;
  readAt: string | null;
}

type DueItemRow = {
  id: number;
  tripId: number;
  description: string;
  scheduledAt: Date | null;
  reminderMinutesBefore: number | null;
  tripReference: string;
};

function formatReminderMessage(row: DueItemRow): string {
  const when = row.scheduledAt
    ? row.scheduledAt.toLocaleString(APP_LOCALE, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : 'soon';
  const lead =
    row.reminderMinutesBefore == null
      ? ''
      : row.reminderMinutesBefore >= 1440
        ? ` (${Math.round(row.reminderMinutesBefore / 1440)}d before)`
        : row.reminderMinutesBefore >= 60
          ? ` (${Math.round(row.reminderMinutesBefore / 60)}h before)`
          : ` (${row.reminderMinutesBefore}m before)`;
  return `${row.tripReference}: ${row.description} — ${when}${lead}`;
}

export async function materializeDueTripReminders(userId: number): Promise<number> {
  const now = new Date();

  const due = await prisma.$queryRaw<DueItemRow[]>`
    SELECT i."id", i."tripId", i."description", i."scheduledAt", i."reminderMinutesBefore",
           t."reference" AS "tripReference"
      FROM "TripItineraryItem" i
      JOIN "Trip" t ON t."id" = i."tripId"
     WHERE i."reminderAt" IS NOT NULL
       AND i."reminderAt" <= ${now}
       AND i."reminderSentAt" IS NULL
       AND (t."createdById" = ${userId} OR t."ownerId" = ${userId})
     LIMIT 100
  `;

  if (due.length === 0) return 0;

  await prisma.$transaction(async (tx) => {
    const ids = due.map((d) => d.id);
    const updated = await tx.$executeRaw`
      UPDATE "TripItineraryItem"
         SET "reminderSentAt" = ${now}
       WHERE "id" IN (${Prisma.join(ids)})
         AND "reminderSentAt" IS NULL
    `;
    if (typeof updated === 'number' && updated === 0) return;

    for (const row of due) {
      await tx.$executeRaw`
        INSERT INTO "TripItineraryItemNotification" ("userId", "itemId", "type", "message", "createdAt")
        VALUES (${userId}, ${row.id}, ${'trip.item.reminder'}, ${formatReminderMessage(row)}, ${now})
      `;
    }
  });

  return due.length;
}

/**
 * Tells the trip's owner and creator that a movement has crew still to assign,
 * since the form no longer insists on it. The unread note is replaced when the
 * gap changes and withdrawn once the crew is complete. Never throws: the event
 * itself has already saved.
 */
export async function syncCrewGapNotifications(params: {
  trip: { id: number; reference: string; ownerId: number | null; createdById: number };
  item: { id: number; description: string };
  gaps: CrewRole[];
  /** What was missing before an edit; a new event has nothing before. */
  before?: CrewRole[];
}): Promise<void> {
  const { trip, item, gaps } = params;
  const before = params.before ?? [];
  if (gaps.join() === before.join()) return;
  try {
    const recipients = [...new Set([trip.ownerId, trip.createdById].filter((id): id is number => id != null))];
    await prisma.tripItineraryItemNotification.deleteMany({
      where: { itemId: item.id, type: CREW_GAP_TYPE, readAt: null },
    });
    if (gaps.length > 0) {
      // "No vehicle or CPO assigned" → "… — no vehicle or CPO assigned".
      const label = crewGapLabel(gaps);
      const message = `${trip.reference}: ${item.description} — ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
      await prisma.tripItineraryItemNotification.createMany({
        data: recipients.map((userId) => ({ userId, itemId: item.id, type: CREW_GAP_TYPE, message })),
      });
    }
    notifyNotificationsChanged(recipients);
  } catch (error) {
    console.error('[trip-notifications] crew gap note failed:', error);
  }
}

type NotificationRow = {
  id: number;
  itemId: number;
  tripId: number;
  type: string;
  message: string;
  createdAt: Date;
  readAt: Date | null;
};

export async function listTripNotifications(
  userId: number,
): Promise<TripItineraryItemNotificationSummary[]> {
  const rows = await prisma.$queryRaw<NotificationRow[]>`
    SELECT n."id", n."itemId", i."tripId", n."type", n."message", n."createdAt", n."readAt"
      FROM "TripItineraryItemNotification" n
      JOIN "TripItineraryItem" i ON i."id" = n."itemId"
     WHERE n."userId" = ${userId}
     ORDER BY n."createdAt" DESC
     LIMIT 25
  `;

  return rows.map((r) => ({
    id: r.id,
    itemId: r.itemId,
    tripId: r.tripId,
    type: r.type,
    message: r.message,
    createdAt: r.createdAt.toISOString(),
    readAt: r.readAt?.toISOString() ?? null,
  }));
}

export async function markTripNotificationsRead(
  userId: number,
  ids: number[],
): Promise<number> {
  const normalized = Array.from(
    new Set(ids.filter((n) => Number.isInteger(n) && n > 0)),
  );
  if (normalized.length === 0) return 0;
  const updated = await prisma.$executeRaw`
    UPDATE "TripItineraryItemNotification"
       SET "readAt" = NOW()
     WHERE "userId" = ${userId} AND "id" IN (${Prisma.join(normalized)})
  `;
  const count = typeof updated === 'number' ? updated : 0;
  if (count > 0) notifyNotificationsChanged(userId);
  return count;
}
