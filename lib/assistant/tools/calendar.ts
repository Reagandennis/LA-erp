import 'server-only';

import { createEvent, deleteEvent, listUpcomingEvents, updateEvent } from '@/lib/calendar';
import { recordAuditEvent } from '@/lib/audit';

import { asInt, asNullableString, asString, type ToolDefinition } from '../types';

const MODULE = 'calendar';

const listEventsTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'list_upcoming_events',
    description: "List the current user's upcoming calendar events.",
    parameters: { type: 'object', properties: {} },
  },
  async handler(_args, ctx) {
    const rows = await listUpcomingEvents(ctx.userId, 15);
    return rows.map((e) => ({ id: e.id, title: e.title, startsAt: e.startsAt, location: e.location }));
  },
};

const createEventTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'create_calendar_event',
    description:
      "Create a calendar event for the current user. startsAt must be an ISO date-time (e.g. 2026-06-20T14:00). Use reminderMinutesBefore for a reminder.",
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        startsAt: { type: 'string', description: 'ISO date-time, e.g. 2026-06-20T14:00' },
        endsAt: { type: 'string', description: 'ISO date-time (optional)' },
        location: { type: 'string' },
        description: { type: 'string' },
        reminderMinutesBefore: { type: 'integer' },
      },
      required: ['title', 'startsAt'],
    },
  },
  async handler(args, ctx) {
    const title = asString(args.title);
    const startsRaw = asString(args.startsAt);
    if (!title) return { error: 'An event title is required.' };
    if (!startsRaw) return { error: 'A start time (startsAt) is required.' };
    const startsAt = new Date(startsRaw);
    if (Number.isNaN(startsAt.getTime())) return { error: 'startsAt is not a valid date-time.' };
    const endsRaw = asString(args.endsAt);
    const endsAt = endsRaw ? new Date(endsRaw) : null;
    const event = await createEvent(ctx.userId, {
      title,
      description: asNullableString(args.description),
      location: asNullableString(args.location),
      startsAt,
      endsAt: endsAt && !Number.isNaN(endsAt.getTime()) ? endsAt : null,
      reminderMinutesBefore: asInt(args.reminderMinutesBefore) ?? null,
    });
    await recordAuditEvent({
      action: 'ai.calendar.create', entityType: 'CalendarEvent', entityId: String(event.id),
      actorUserId: ctx.userId, metadata: { title: event.title }, request: ctx.request,
    });
    return { id: event.id, title: event.title, startsAt: event.startsAt };
  },
};

const deleteEventTool: ToolDefinition = {
  destructive: true,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'delete_calendar_event',
    description: 'Delete one of the current user\'s calendar events.',
    parameters: {
      type: 'object',
      properties: { eventId: { type: 'integer' } },
      required: ['eventId'],
    },
  },
  async handler(args, ctx) {
    const id = asInt(args.eventId);
    if (!id) return { error: 'A valid eventId is required.' };
    const ok = await deleteEvent(id, ctx.userId);
    if (!ok) return { error: 'Event not found.' };
    await recordAuditEvent({
      action: 'ai.calendar.delete', entityType: 'CalendarEvent', entityId: String(id),
      actorUserId: ctx.userId, request: ctx.request,
    });
    return { deleted: true, eventId: id };
  },
};

const updateEventTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'update_calendar_event',
    description: 'Update one of the current user\'s calendar events — title, time, location, description, or reminder. Provide only fields to change.',
    parameters: {
      type: 'object',
      properties: {
        eventId: { type: 'integer' },
        title: { type: 'string' },
        startsAt: { type: 'string', description: 'ISO date-time' },
        endsAt: { type: 'string', description: 'ISO date-time' },
        location: { type: 'string' },
        description: { type: 'string' },
        reminderMinutesBefore: { type: 'integer' },
      },
      required: ['eventId'],
    },
  },
  async handler(args, ctx) {
    const id = asInt(args.eventId);
    if (!id) return { error: 'A valid eventId is required.' };
    const patch: Record<string, unknown> = {};
    if (args.title !== undefined) patch.title = asString(args.title);
    if (args.location !== undefined) patch.location = asNullableString(args.location);
    if (args.description !== undefined) patch.description = asNullableString(args.description);
    if (args.reminderMinutesBefore !== undefined) patch.reminderMinutesBefore = asInt(args.reminderMinutesBefore) ?? null;
    if (args.startsAt !== undefined) {
      const d = new Date(String(args.startsAt));
      if (Number.isNaN(d.getTime())) return { error: 'startsAt is not a valid date-time.' };
      patch.startsAt = d;
    }
    if (args.endsAt !== undefined) {
      const e = new Date(String(args.endsAt));
      patch.endsAt = Number.isNaN(e.getTime()) ? null : e;
    }
    if (Object.keys(patch).length === 0) return { error: 'Provide at least one field to update.' };
    const result = await updateEvent(id, ctx.userId, patch);
    if (result.status === 'not_found') return { error: 'Event not found.' };
    await recordAuditEvent({ action: 'ai.calendar.update', entityType: 'CalendarEvent', entityId: String(id), actorUserId: ctx.userId, request: ctx.request });
    return { id: result.event.id, title: result.event.title, startsAt: result.event.startsAt };
  },
};

export const calendarTools: ToolDefinition[] = [listEventsTool, createEventTool, updateEventTool, deleteEventTool];
