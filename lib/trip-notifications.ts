import 'server-only';

import { Prisma } from '@prisma/client';

import { prisma } from './prisma';

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
    ? row.scheduledAt.toLocaleString(undefined, {
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
  return typeof updated === 'number' ? updated : 0;
}
