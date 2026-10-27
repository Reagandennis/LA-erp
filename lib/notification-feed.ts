import 'server-only';

import { listCalendarNotifications, materializeDueCalendarReminders } from './calendar';
import { listMessageNotifications } from './communication';
import { listFileNotifications } from './files';
import { listMaintenanceNotifications, materializeMaintenanceReminders } from './fleet-reminders';
import { listInvoiceNotifications } from './invoices';
import { prisma } from './prisma';
import { listQuoteNotifications } from './quotes';
import { listTripNotifications, materializeDueTripReminders } from './trip-notifications';

type PersonalTodoNotificationRow = {
  id: number;
  todoId: number;
  type: string;
  message: string;
  createdAt: Date;
  readAt: Date | null;
};

export interface PersonalTodoNotificationSummary {
  id: number;
  todoId: number;
  type: string;
  message: string;
  createdAt: string;
  readAt: string | null;
}

export async function listPersonalTodoNotifications(
  userId: number,
): Promise<PersonalTodoNotificationSummary[]> {
  const rows = await prisma.$queryRaw<PersonalTodoNotificationRow[]>`
    SELECT "id", "todoId", "type", "message", "createdAt", "readAt"
    FROM "PersonalTodoNotification"
    WHERE "userId" = ${userId}
    ORDER BY "createdAt" DESC
    LIMIT 10
  `;
  return rows.map((row) => ({
    id: row.id,
    todoId: row.todoId,
    type: row.type,
    message: row.message,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
  }));
}

/** One source failing must not blank the whole bell; log it and show the rest. */
async function settle<T>(source: string, work: Promise<T[]>): Promise<T[]> {
  try {
    return await work;
  } catch (error) {
    console.error(`[notification-feed] ${source} failed:`, error);
    return [];
  }
}

/**
 * Loads every notification source for the bell in one go. Replaces seven
 * separate round-trips (each re-authenticating) with a single request whose
 * queries run concurrently on the server.
 */
export async function loadNotificationFeed(userId: number, access: { maintenance?: boolean } = {}) {
  const [todo, quote, invoice, trip, message, file, calendar, maintenance] = await Promise.all([
    settle('todo', listPersonalTodoNotifications(userId)),
    settle('quote', listQuoteNotifications(userId)),
    settle('invoice', listInvoiceNotifications(userId)),
    settle(
      'trip',
      materializeDueTripReminders(userId).then(() => listTripNotifications(userId)),
    ),
    settle('message', listMessageNotifications(userId)),
    settle('file', listFileNotifications(userId)),
    settle(
      'calendar',
      materializeDueCalendarReminders(userId).then(() => listCalendarNotifications(userId)),
    ),
    // Only for those who can open Car Maintenance: losing it hides what was sent before.
    access.maintenance
      ? settle(
          'maintenance',
          materializeMaintenanceReminders(userId).then(() => listMaintenanceNotifications(userId)),
        )
      : Promise.resolve([]),
  ]);

  return { todo, quote, invoice, trip, message, file, calendar, maintenance };
}

export type NotificationFeed = Awaited<ReturnType<typeof loadNotificationFeed>>;
