import 'server-only';

import { recordAuditEvent } from '@/lib/audit';
import { SERVICE_COUNTRIES } from '@/lib/service-catalog';
import { isServiceCountry } from '@/lib/trip-reference';
import { createTrip, deleteTrip, listTripsForUser, updateTrip, type TripStatus, type TripUpdateInput } from '@/lib/trips';

import { asInt, asNullableString, asString, type ToolDefinition } from '../types';
import { dateIso } from './_shared';

const TRIP_STATUSES = ['Draft', 'Planned', 'Active', 'Completed', 'Cancelled'];

const MODULE = 'trip-planning';

const listTripsTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'list_trips',
    description: 'List trips the user can access (newest first). Use to find a trip ID.',
    parameters: { type: 'object', properties: {} },
  },
  async handler(_args, ctx) {
    const rows = await listTripsForUser({ userId: ctx.userId, isAdmin: ctx.isAdmin });
    return rows.slice(0, 30).map((t) => ({
      id: t.id,
      reference: t.reference,
      title: t.title,
      status: t.status,
      customer: t.customer?.name,
    }));
  },
};

const createTripTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'create_trip',
    description:
      'Create a trip for a client. Find the client ID with list_customers. Dates are YYYY-MM-DD (optional). ' +
      "The reference is made from the client's code, the country, the start month and the next number.",
    parameters: {
      type: 'object',
      properties: {
        customerId: { type: 'integer' },
        country: { type: 'string', enum: [...SERVICE_COUNTRIES], description: 'Where the trip is' },
        title: { type: 'string' },
        description: { type: 'string' },
        startDate: { type: 'string', description: 'YYYY-MM-DD' },
        endDate: { type: 'string', description: 'YYYY-MM-DD' },
        currency: { type: 'string', description: '3-letter code, default USD' },
      },
      required: ['customerId', 'country', 'title'],
    },
  },
  async handler(args, ctx) {
    const customerId = asInt(args.customerId);
    const title = asString(args.title);
    if (!customerId) return { error: 'A valid customerId is required (use list_customers).' };
    if (!isServiceCountry(args.country)) return { error: `Which country is the trip in? One of: ${SERVICE_COUNTRIES.join(', ')}.` };
    if (!title) return { error: 'A trip title is required.' };
    const trip = await createTrip({
      customerId,
      country: args.country,
      ownerId: ctx.userId,
      title,
      description: asNullableString(args.description),
      startDate: dateIso(args.startDate, null),
      endDate: dateIso(args.endDate, null),
      currency: asString(args.currency) ?? 'USD',
      notes: null,
      items: [],
      createdById: ctx.userId,
    });
    await recordAuditEvent({
      action: 'ai.trip.create',
      entityType: 'Trip',
      entityId: String(trip.id),
      actorUserId: ctx.userId,
      metadata: { reference: trip.reference },
      request: ctx.request,
    });
    return { id: trip.id, reference: trip.reference, title: trip.title, status: trip.status };
  },
};

const deleteTripTool: ToolDefinition = {
  destructive: true,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'delete_trip',
    description: 'Delete a draft or cancelled trip.',
    parameters: {
      type: 'object',
      properties: { tripId: { type: 'integer' } },
      required: ['tripId'],
    },
  },
  async handler(args, ctx) {
    const id = asInt(args.tripId);
    if (!id) return { error: 'A valid tripId is required.' };
    const result = await deleteTrip({ id, userId: ctx.userId, isAdmin: ctx.isAdmin });
    if (result !== true) return result;
    await recordAuditEvent({
      action: 'ai.trip.delete',
      entityType: 'Trip',
      entityId: String(id),
      actorUserId: ctx.userId,
      request: ctx.request,
    });
    return { deleted: true, tripId: id };
  },
};

const updateTripTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'update_trip',
    description:
      'Update a trip — title, description, status, dates, or currency. Status is one of Draft, Planned, Active, Completed, Cancelled. Provide only fields to change.',
    parameters: {
      type: 'object',
      properties: {
        tripId: { type: 'integer' },
        title: { type: 'string' },
        description: { type: 'string' },
        status: { type: 'string', enum: TRIP_STATUSES },
        startDate: { type: 'string', description: 'YYYY-MM-DD' },
        endDate: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['tripId'],
    },
  },
  async handler(args, ctx) {
    const id = asInt(args.tripId);
    if (!id) return { error: 'A valid tripId is required.' };
    const input: TripUpdateInput = {};
    if (args.title !== undefined) input.title = asString(args.title);
    if (args.description !== undefined) input.description = asNullableString(args.description);
    if (typeof args.status === 'string' && TRIP_STATUSES.includes(args.status)) input.status = args.status as TripStatus;
    if (args.startDate !== undefined) input.startDate = dateIso(args.startDate, null);
    if (args.endDate !== undefined) input.endDate = dateIso(args.endDate, null);
    if (Object.keys(input).length === 0) return { error: 'Provide at least one field to update.' };
    const result = await updateTrip({ id, userId: ctx.userId, isAdmin: ctx.isAdmin, input });
    if ('error' in result) return result;
    await recordAuditEvent({
      action: 'ai.trip.update', entityType: 'Trip', entityId: String(id),
      actorUserId: ctx.userId, request: ctx.request,
    });
    return { id: result.id, reference: result.reference, title: result.title, status: result.status };
  },
};

export const tripTools: ToolDefinition[] = [listTripsTool, createTripTool, updateTripTool, deleteTripTool];
