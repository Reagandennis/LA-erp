import 'server-only';

import { activeMaintenanceReminders, dateToDateKey, localDateKey, reminderMessage } from './fleet';
import { listVehicleOdometers } from './fleet-server';
import { notifyNotificationsChanged } from './notification-events';
import { prisma } from './prisma';
import { ADMIN_ROLE_NAME } from './rbac';
import { type AccessUser, userHasModule, userHasRole } from './user';

/**
 * Car Maintenance reminders in the notifications bell. Like trip and calendar
 * reminders they are written when the bell loads (every minute while a page is
 * open), not by a timer: whoever can open Car Maintenance gets each live
 * reminder once, keyed so a rescheduled job reminds again.
 */
export function canUseFleetMaintenance(user: AccessUser): boolean {
  return userHasRole(user, ADMIN_ROLE_NAME) || userHasModule(user, 'car-maintenance');
}

/** Just what the reminder rules read. Cancelled work never reminds or books anything. */
async function listReminderSources() {
  const rows = await prisma.vehicleMaintenance.findMany({
    where: { status: { not: 'Cancelled' } },
    select: {
      id: true,
      category: true,
      title: true,
      status: true,
      scheduledFor: true,
      completedAt: true,
      nextDueAt: true,
      nextDueKm: true,
      reminderDays: true,
      vehicle: { select: { id: true, registration: true, make: true, model: true } },
    },
  });
  const key = (d: Date | null) => (d ? dateToDateKey(d) : null);
  return rows.map((row) => ({
    ...row,
    scheduledFor: key(row.scheduledFor),
    completedAt: key(row.completedAt),
    nextDueAt: key(row.nextDueAt),
  }));
}

export async function materializeMaintenanceReminders(userId: number, today: string = localDateKey()): Promise<number> {
  const [items, odometers] = await Promise.all([listReminderSources(), listVehicleOdometers()]);
  const due = activeMaintenanceReminders(items, odometers, today);
  if (due.length === 0) return 0;

  // The unique (userId, reminderKey) index makes this safe from two tabs at once.
  const { count } = await prisma.vehicleMaintenanceNotification.createMany({
    data: due.map((reminder) => ({
      userId,
      maintenanceId: reminder.item.id,
      reminderKey: reminder.key,
      type: `fleet.maintenance.${reminder.stage}`,
      message: reminderMessage(reminder),
    })),
    skipDuplicates: true,
  });
  return count;
}

export async function listMaintenanceNotifications(userId: number) {
  const rows = await prisma.vehicleMaintenanceNotification.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 25,
    select: { id: true, maintenanceId: true, type: true, message: true, createdAt: true, readAt: true },
  });
  return rows.map((r) => ({
    id: r.id,
    maintenanceId: r.maintenanceId,
    type: r.type,
    message: r.message,
    createdAt: r.createdAt.toISOString(),
    readAt: r.readAt?.toISOString() ?? null,
  }));
}

export async function markMaintenanceNotificationsRead(userId: number, ids: number[]): Promise<number> {
  const normalized = Array.from(new Set(ids.filter((id) => Number.isInteger(id) && id > 0)));
  if (normalized.length === 0) return 0;
  const result = await prisma.vehicleMaintenanceNotification.updateMany({
    where: { userId, id: { in: normalized }, readAt: null },
    data: { readAt: new Date() },
  });
  if (result.count > 0) notifyNotificationsChanged(userId);
  return result.count;
}
