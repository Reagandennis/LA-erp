import 'server-only';

import { API_ACCESS } from '@/lib/api-access';
import { type CalendarEventSummary, createEvent, deleteEvent, listEvents, updateEvent } from '@/lib/calendar';
import { prisma } from '@/lib/prisma';
import { utcToZoned } from '@/lib/zoned-time';

import { asString, type JsonSchema, type ToolContext, type ToolDefinition, ToolRefusal } from '../types';
import {
  audit,
  changedFields,
  localStamp,
  matches,
  optAmount,
  optDate,
  optFlag,
  optText,
  optTime,
  pageOf,
  reqDate,
  reqId,
  reqText,
  requireChange,
  todayIn,
  toUtc,
} from './_shared';

const MODULE = API_ACCESS.calendar;
const HREF = '/modules/calendar';
const PAGE_SIZE = 20;
/** With no range given, the list looks this far ahead. */
const DEFAULT_DAYS = 90;
/** Four weeks: longer than any reminder the calendar offers, and far inside what the column holds. */
const MAX_REMINDER_MINUTES = 60 * 24 * 28;

type Args = Record<string, unknown>;
type EventFacts = Pick<
  CalendarEventSummary,
  'id' | 'title' | 'description' | 'location' | 'tag' | 'startsAt' | 'endsAt' | 'allDay' | 'reminderMinutesBefore' | 'googleEventId'
>;

const clip = (text: string | null, max: number) => (text && text.length > max ? `${text.slice(0, max)}…` : text);

/** A calendar date some days on: pure date arithmetic, no clock or zone involved. */
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** An event as the user reads it: an all-day event is a date, anything else a local date and time. */
function eventView(event: EventFacts, zone: string) {
  return {
    id: event.id,
    title: event.title,
    allDay: event.allDay,
    starts: event.allDay ? utcToZoned(event.startsAt, zone).date : localStamp(event.startsAt, zone),
    ends: event.allDay ? null : localStamp(event.endsAt, zone),
    location: event.location,
    description: event.description,
    tag: event.tag,
    reminderMinutesBefore: event.reminderMinutesBefore,
  };
}

const EVENT_FIELDS = ['title', 'allDay', 'starts', 'ends', 'location', 'description', 'tag', 'reminderMinutesBefore'] as const;

const compact = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null));

async function loadEvent(id: number, ctx: ToolContext): Promise<EventFacts> {
  const row = await prisma.calendarEvent.findFirst({
    where: { id, userId: ctx.userId },
    select: {
      id: true, title: true, description: true, location: true, tag: true, startsAt: true, endsAt: true,
      allDay: true, reminderMinutesBefore: true, googleEventId: true,
    },
  });
  if (!row) throw new ToolRefusal(`Calendar event ${id} was not found on this user's calendar. Find it with list_upcoming_events.`);
  return { ...row, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt?.toISOString() ?? null };
}

function readReminder(args: Args): number | null | undefined {
  if (args.reminderMinutesBefore === null) return null;
  return optAmount(args, 'reminderMinutesBefore', { min: 0, max: MAX_REMINDER_MINUTES, integer: true });
}

const NO_TIMES_ALL_DAY = 'An all-day event has no times and covers one day: leave time, endTime and endDate out (add one event per day).';

const listEventsTool: ToolDefinition = {
  destructive: false,
  kind: 'read',
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'list_upcoming_events',
    description:
      `The user's own calendar events in a date range, soonest first, in their local time. With no range: today and the next ${DEFAULT_DAYS} days. ${PAGE_SIZE} per page.`,
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'YYYY-MM-DD, first day (default today)' },
        to: { type: 'string', description: 'YYYY-MM-DD, last day, inclusive' },
        q: { type: 'string', description: 'Words in the title, location, description or tag' },
        page: { type: 'integer' },
      },
    },
  },
  async handler(args, ctx) {
    const zone = ctx.timeZone;
    const from = optDate(args, 'from') ?? todayIn(zone);
    const to = optDate(args, 'to') ?? addDays(from, DEFAULT_DAYS);
    if (to < from) throw new ToolRefusal(`to (${to}) is before from (${from}).`);
    const q = asString(args.q);
    const rows = await listEvents(
      ctx.userId,
      new Date(toUtc(from, '00:00', zone, 'from date')),
      new Date(toUtc(addDays(to, 1), '00:00', zone, 'to date')),
    );
    const page = pageOf(
      rows.filter((e) => matches(q, e.title, e.location, e.description, e.tag)),
      args,
      PAGE_SIZE,
    );
    return {
      from,
      to,
      total: page.total,
      page: page.page,
      more: page.more,
      events: page.rows.map((e) => compact({ ...eventView(e, zone), description: clip(e.description, 200) })),
      timesShownIn: zone,
    };
  },
};

const sharedProperties: Record<string, JsonSchema> = {
  title: { type: 'string' },
  date: { type: 'string', description: 'YYYY-MM-DD, the day it starts' },
  time: { type: 'string', description: "24-hour HH:MM start, in the user's time zone" },
  allDay: { type: 'boolean', description: 'true for a whole-day event with no times' },
};

const createEventTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'create_calendar_event',
    description:
      "Add an event to the user's own calendar. Give the date and a start time, or allDay: true for a whole day. Times are in the user's time zone.",
    parameters: {
      type: 'object',
      properties: {
        ...sharedProperties,
        endTime: { type: 'string', description: '24-hour HH:MM' },
        endDate: { type: 'string', description: 'YYYY-MM-DD, only when it ends on a later day' },
        location: { type: 'string' },
        description: { type: 'string' },
        tag: { type: 'string', description: 'A short label, e.g. Team' },
        reminderMinutesBefore: { type: 'integer', description: 'Minutes before the start to remind the user: 0, 5, 10, 30, 60, 1440' },
      },
      required: ['title', 'date'],
    },
  },
  async handler(args, ctx) {
    const zone = ctx.timeZone;
    const title = reqText(args, 'title', { max: 200 });
    const date = reqDate(args, 'date');
    const allDay = optFlag(args, 'allDay') ?? false;
    const time = optTime(args, 'time');
    const endTime = optTime(args, 'endTime');
    const endDate = optDate(args, 'endDate');

    let startsAt: string;
    let endsAt: string | null = null;
    if (allDay) {
      if (time || endTime || endDate) throw new ToolRefusal(NO_TIMES_ALL_DAY);
      // As the calendar stores it: the day's local midnight, no end.
      startsAt = toUtc(date, '00:00', zone, 'date');
    } else {
      if (!time) throw new ToolRefusal('Give the start time (time, HH:MM), or allDay: true for a whole-day event.');
      startsAt = toUtc(date, time, zone, 'start time');
      if (endDate && !endTime) throw new ToolRefusal('endDate needs endTime as well.');
      if (endTime) {
        endsAt = toUtc(endDate ?? date, endTime, zone, 'end time');
        if (endsAt <= startsAt) throw new ToolRefusal(`The event would end (${endDate ?? date} ${endTime}) before it starts (${date} ${time}). For an event that runs past midnight, give endDate.`);
      }
    }

    const event = await createEvent(ctx.userId, {
      title,
      description: optText(args, 'description', { max: 4000 }) ?? null,
      location: optText(args, 'location', { max: 300 }) ?? null,
      tag: optText(args, 'tag', { max: 40 }) ?? null,
      startsAt: new Date(startsAt),
      endsAt: endsAt ? new Date(endsAt) : null,
      allDay,
      reminderMinutesBefore: readReminder(args) ?? null,
    });
    await audit({
      action: 'ai.calendar.create', entityType: 'CalendarEvent', entityId: String(event.id),
      actorUserId: ctx.userId, metadata: { title: event.title }, request: ctx.request,
    });
    const view = eventView(event, zone);
    return {
      ...compact(view),
      timesShownIn: zone,
      href: HREF,
      summary: `Added "${event.title}" to the calendar ${event.allDay ? `on ${view.starts} (all day)` : `at ${view.starts}`}`,
    };
  },
};

const updateEventTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'update_calendar_event',
    description:
      "Change one of the user's own calendar events. Send only what should change: a new date keeps the time, a new time keeps the date. Times are in the user's time zone.",
    parameters: {
      type: 'object',
      properties: {
        eventId: { type: 'integer' },
        ...sharedProperties,
        endTime: { type: 'string', description: '24-hour HH:MM; null removes the end time', nullable: true },
        endDate: { type: 'string', description: 'YYYY-MM-DD, only when it ends on a later day' },
        location: { type: 'string', description: 'null clears it', nullable: true },
        description: { type: 'string', description: 'null clears it', nullable: true },
        tag: { type: 'string', description: 'null clears it', nullable: true },
        reminderMinutesBefore: { type: 'integer', description: 'Minutes before the start; null removes the reminder', nullable: true },
      },
      required: ['eventId'],
    },
  },
  async handler(args, ctx) {
    const zone = ctx.timeZone;
    const id = reqId(args, 'eventId', 'use list_upcoming_events');
    const before = await loadEvent(id, ctx);

    const patch: Parameters<typeof updateEvent>[2] = {};
    const title = optText(args, 'title', { max: 200 });
    if (title != null) patch.title = title;
    for (const [key, max] of [['location', 300], ['description', 4000], ['tag', 40]] as const) {
      const value = optText(args, key, { max });
      if (value !== undefined) patch[key] = value;
    }
    const reminder = readReminder(args);
    if (reminder !== undefined) patch.reminderMinutesBefore = reminder;

    // When: what was given, laid over the event's own local date and times.
    const date = optDate(args, 'date');
    const time = optTime(args, 'time');
    const endTime = optTime(args, 'endTime');
    const endDate = optDate(args, 'endDate');
    const allDayGiven = optFlag(args, 'allDay');
    const allDay = allDayGiven ?? before.allDay;
    const start = utcToZoned(before.startsAt, zone);
    const onDate = date ?? start.date;

    if (allDay) {
      if (time || endTime || endDate) {
        throw new ToolRefusal(
          before.allDay && allDayGiven === undefined
            ? 'This is an all-day event: to give it times, send allDay: false together with the time.'
            : NO_TIMES_ALL_DAY,
        );
      }
      if (!before.allDay) {
        patch.allDay = true;
        patch.endsAt = null;
      }
      if (date || !before.allDay) patch.startsAt = new Date(toUtc(onDate, '00:00', zone, 'date'));
    } else {
      const atTime = time ?? (before.allDay ? undefined : start.time);
      if (!atTime) throw new ToolRefusal('Give the start time (time, HH:MM) to turn an all-day event into a timed one.');
      if (before.allDay) patch.allDay = false;
      const startsAt = toUtc(onDate, atTime, zone, 'start time');
      if (date || time || before.allDay) patch.startsAt = new Date(startsAt);

      let end = before.endsAt && !before.allDay ? utcToZoned(before.endsAt, zone) : null;
      if (args.endTime === null) {
        if (endDate) throw new ToolRefusal('endDate cannot be set while endTime is being removed.');
        end = null;
        patch.endsAt = null;
      } else if (endTime) {
        end = { date: endDate ?? onDate, time: endTime };
      } else if (endDate) {
        if (!end) throw new ToolRefusal('endDate needs endTime as well: this event has no end time yet.');
        end = { date: endDate, time: end.time };
      } else if (end && date) {
        // Moving the day moves the end with it, as it does on the calendar's own form.
        end = { date: addDays(end.date, daysBetween(start.date, date)), time: end.time };
      }
      // Only when the start or the end was touched: an untouched event is never rewritten.
      if (end && (date || time || endTime || endDate)) {
        const endsAt = toUtc(end.date, end.time, zone, 'end time');
        if (endsAt <= startsAt) {
          throw new ToolRefusal(
            `The event would end (${end.date} ${end.time}) before it starts (${onDate} ${atTime}). Give endTime as well, or endTime: null to remove the end.`,
          );
        }
        if (date || endTime || endDate) patch.endsAt = new Date(endsAt);
      }
    }

    if (Object.keys(patch).length === 0) throw new ToolRefusal('Say what to change on the event.');
    const result = await updateEvent(id, ctx.userId, patch);
    if (result.status === 'not_found') throw new ToolRefusal(`Calendar event ${id} was not found.`);

    const view = eventView(result.event, zone);
    const changed = changedFields(eventView(before, zone), view, EVENT_FIELDS);
    requireChange(changed, `"${before.title}"`);
    await audit({
      action: 'ai.calendar.update', entityType: 'CalendarEvent', entityId: String(id),
      actorUserId: ctx.userId, metadata: { fields: Object.keys(changed) }, request: ctx.request,
    });
    return {
      id,
      title: result.event.title,
      changed,
      ...(before.googleEventId ? { note: 'This event was also put on Google Calendar from the calendar page; the copy there is not changed.' } : {}),
      timesShownIn: zone,
      href: HREF,
      summary: `Updated "${result.event.title}" on the calendar: ${Object.keys(changed).join(', ')}`,
    };
  },
};

const deleteEventTool: ToolDefinition = {
  destructive: true,
  requiredModule: MODULE,
  confirmLabel: (args) => `Delete the calendar event ${asString(args.title) ? `"${asString(args.title)}"` : `#${args.eventId}`}`,
  functionDeclaration: {
    name: 'delete_calendar_event',
    description: "Delete one of the user's own calendar events. Cannot be undone.",
    parameters: {
      type: 'object',
      properties: {
        eventId: { type: 'integer' },
        title: { type: 'string', description: "The event's title, shown to the user when they confirm" },
      },
      required: ['eventId'],
    },
  },
  async handler(args, ctx) {
    const id = reqId(args, 'eventId');
    const event = await loadEvent(id, ctx);
    const ok = await deleteEvent(id, ctx.userId);
    if (!ok) throw new ToolRefusal(`Calendar event ${id} was not found.`);
    await audit({
      action: 'ai.calendar.delete', entityType: 'CalendarEvent', entityId: String(id),
      actorUserId: ctx.userId, metadata: { title: event.title }, request: ctx.request,
    });
    return {
      deleted: true,
      eventId: id,
      ...(event.googleEventId ? { note: 'The copy on Google Calendar is not deleted.' } : {}),
      href: HREF,
      summary: `Deleted "${event.title}" from the calendar`,
    };
  },
};

export const calendarTools: ToolDefinition[] = [listEventsTool, createEventTool, updateEventTool, deleteEventTool];
