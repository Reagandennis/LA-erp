import { APP_LOCALE } from './locale';
import 'server-only';

import { notifyNotificationsChanged } from '@/lib/notification-events';
import { prisma } from '@/lib/prisma';

export type CalendarEventSummary = {
  id: number;
  title: string;
  description: string | null;
  location: string | null;
  tag: string | null;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  reminderMinutesBefore: number | null;
  googleEventId: string | null;
  createdAt: string;
};

const SELECT = {
  id: true,
  title: true,
  description: true,
  location: true,
  tag: true,
  startsAt: true,
  endsAt: true,
  allDay: true,
  reminderMinutesBefore: true,
  googleEventId: true,
  createdAt: true,
} as const;

type Row = {
  id: number;
  title: string;
  description: string | null;
  location: string | null;
  tag: string | null;
  startsAt: Date;
  endsAt: Date | null;
  allDay: boolean;
  reminderMinutesBefore: number | null;
  googleEventId: string | null;
  createdAt: Date;
};

function serialize(row: Row): CalendarEventSummary {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    location: row.location,
    tag: row.tag,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt?.toISOString() ?? null,
    allDay: row.allDay,
    reminderMinutesBefore: row.reminderMinutesBefore,
    googleEventId: row.googleEventId,
    createdAt: row.createdAt.toISOString(),
  };
}

export function computeReminderAt(startsAt: Date, minutesBefore: number | null | undefined): Date | null {
  if (minutesBefore == null || !Number.isFinite(minutesBefore) || minutesBefore < 0) return null;
  return new Date(startsAt.getTime() - minutesBefore * 60_000);
}

/** Events for a user that overlap [from, to). */
export async function listEvents(userId: number, from: Date, to: Date): Promise<CalendarEventSummary[]> {
  const rows = await prisma.calendarEvent.findMany({
    where: { userId, startsAt: { gte: from, lt: to } },
    orderBy: [{ startsAt: 'asc' }],
    select: SELECT,
  });
  return rows.map(serialize);
}

/** Upcoming events from now, for the upcoming list. */
export async function listUpcomingEvents(userId: number, limit = 8): Promise<CalendarEventSummary[]> {
  const rows = await prisma.calendarEvent.findMany({
    where: { userId, startsAt: { gte: new Date(Date.now() - 12 * 60 * 60 * 1000) } },
    orderBy: [{ startsAt: 'asc' }],
    take: limit,
    select: SELECT,
  });
  return rows.map(serialize);
}

export async function createEvent(
  userId: number,
  input: {
    title: string;
    description?: string | null;
    location?: string | null;
    tag?: string | null;
    startsAt: Date;
    endsAt?: Date | null;
    allDay?: boolean;
    reminderMinutesBefore?: number | null;
    googleEventId?: string | null;
  },
): Promise<CalendarEventSummary> {
  const title = input.title.trim();
  if (!title) throw new Error('Title is required');
  if (Number.isNaN(input.startsAt.getTime())) throw new Error('A valid start time is required');

  const row = await prisma.calendarEvent.create({
    data: {
      userId,
      title,
      description: input.description?.trim() || null,
      location: input.location?.trim() || null,
      tag: input.tag?.trim() || null,
      startsAt: input.startsAt,
      endsAt: input.endsAt ?? null,
      allDay: input.allDay ?? false,
      reminderMinutesBefore: input.reminderMinutesBefore ?? null,
      reminderAt: computeReminderAt(input.startsAt, input.reminderMinutesBefore),
      googleEventId: input.googleEventId ?? null,
    },
    select: SELECT,
  });
  return serialize(row);
}

export type WriteResult =
  | { status: 'ok'; event: CalendarEventSummary }
  | { status: 'not_found' };

export async function updateEvent(
  id: number,
  userId: number,
  patch: {
    title?: string;
    description?: string | null;
    location?: string | null;
    tag?: string | null;
    startsAt?: Date;
    endsAt?: Date | null;
    allDay?: boolean;
    reminderMinutesBefore?: number | null;
    googleEventId?: string | null;
  },
): Promise<WriteResult> {
  const existing = await prisma.calendarEvent.findFirst({
    where: { id, userId },
    select: { id: true, startsAt: true, reminderMinutesBefore: true },
  });
  if (!existing) return { status: 'not_found' };

  const data: Record<string, unknown> = {};
  if (patch.title !== undefined) {
    const t = patch.title.trim();
    if (t) data.title = t;
  }
  if (patch.description !== undefined) data.description = patch.description?.trim() || null;
  if (patch.location !== undefined) data.location = patch.location?.trim() || null;
  if (patch.tag !== undefined) data.tag = patch.tag?.trim() || null;
  if (patch.allDay !== undefined) data.allDay = patch.allDay;
  if (patch.googleEventId !== undefined) data.googleEventId = patch.googleEventId;
  if (patch.endsAt !== undefined) data.endsAt = patch.endsAt;

  // Recompute reminder if start time or reminder lead changes.
  const nextStart = patch.startsAt ?? existing.startsAt;
  const nextLead =
    patch.reminderMinutesBefore !== undefined ? patch.reminderMinutesBefore : existing.reminderMinutesBefore;
  if (patch.startsAt !== undefined) data.startsAt = patch.startsAt;
  if (patch.startsAt !== undefined || patch.reminderMinutesBefore !== undefined) {
    data.reminderMinutesBefore = nextLead;
    data.reminderAt = computeReminderAt(nextStart, nextLead);
    data.reminderSentAt = null;
  }

  const row = await prisma.calendarEvent.update({ where: { id }, data, select: SELECT });
  return { status: 'ok', event: serialize(row) };
}

export async function deleteEvent(id: number, userId: number): Promise<boolean> {
  const existing = await prisma.calendarEvent.findFirst({ where: { id, userId }, select: { id: true } });
  if (!existing) return false;
  await prisma.calendarEvent.delete({ where: { id } });
  return true;
}

function formatReminderMessage(title: string, startsAt: Date, minutesBefore: number | null): string {
  const when = startsAt.toLocaleString(APP_LOCALE, { dateStyle: 'medium', timeStyle: 'short' });
  const lead =
    minutesBefore == null
      ? ''
      : minutesBefore >= 1440
        ? ` (${Math.round(minutesBefore / 1440)}d before)`
        : minutesBefore >= 60
          ? ` (${Math.round(minutesBefore / 60)}h before)`
          : ` (${minutesBefore}m before)`;
  return `${title} — ${when}${lead}`;
}

/** Turn any due reminders into notification rows (lazy sweep, mirrors trip reminders). */
export async function materializeDueCalendarReminders(userId: number): Promise<number> {
  const now = new Date();
  const due = await prisma.calendarEvent.findMany({
    where: { userId, reminderAt: { not: null, lte: now }, reminderSentAt: null },
    select: { id: true, title: true, startsAt: true, reminderMinutesBefore: true },
    take: 100,
  });
  if (due.length === 0) return 0;

  await prisma.$transaction(async (tx) => {
    for (const event of due) {
      const updated = await tx.calendarEvent.updateMany({
        where: { id: event.id, reminderSentAt: null },
        data: { reminderSentAt: now },
      });
      if (updated.count === 0) continue;
      await tx.calendarEventNotification.create({
        data: {
          userId,
          eventId: event.id,
          type: 'calendar.event.reminder',
          message: formatReminderMessage(event.title, event.startsAt, event.reminderMinutesBefore),
        },
      });
    }
  });

  return due.length;
}

type NotificationRow = {
  id: number;
  eventId: number;
  type: string;
  message: string;
  createdAt: Date;
  readAt: Date | null;
};

export async function listCalendarNotifications(userId: number) {
  const rows = (await prisma.calendarEventNotification.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 25,
    select: { id: true, eventId: true, type: true, message: true, createdAt: true, readAt: true },
  })) as NotificationRow[];

  return rows.map((r) => ({
    id: r.id,
    eventId: r.eventId,
    type: r.type,
    message: r.message,
    createdAt: r.createdAt.toISOString(),
    readAt: r.readAt?.toISOString() ?? null,
  }));
}

export async function markCalendarNotificationsRead(userId: number, ids: number[]): Promise<number> {
  const normalized = Array.from(new Set(ids.filter((id) => Number.isInteger(id) && id > 0)));
  if (normalized.length === 0) return 0;
  const result = await prisma.calendarEventNotification.updateMany({
    where: { userId, id: { in: normalized } },
    data: { readAt: new Date() },
  });
  if (result.count > 0) notifyNotificationsChanged(userId);
  return result.count;
}
