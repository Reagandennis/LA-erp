import 'server-only';

import { airportTimeZone } from '@/lib/airports';
import { crewGapLabel, crewGaps } from '@/lib/crew-gaps';
import { SERVICE_COUNTRIES } from '@/lib/service-catalog';
import { canSeeTripCosts, tripForViewer } from '@/lib/trip-costs';
import { type CrewOption, listCrewOptions } from '@/lib/trip-crew';
import { isServiceCountry } from '@/lib/trip-reference';
import {
  addTripItems,
  createTrip,
  createTripDay,
  deleteTrip,
  deleteTripDay,
  deleteTripItem,
  getTripForUser,
  searchTrips,
  TRIP_SORTS,
  TRIP_STATUSES,
  type TripDetail,
  type TripItineraryItemDraft,
  type TripItineraryItemSummary,
  type TripItineraryItemUpdateInput,
  type TripSort,
  type TripStatus,
  type TripUpdateInput,
  updateTrip,
  updateTripDay,
  updateTripItem,
} from '@/lib/trips';
import {
  tripDayCreateSchema,
  tripDayUpdateSchema,
  tripItemDetailKeys,
  tripItineraryItemAddSchema,
  tripItineraryItemUpdateSchema,
  tripUpdateSchema,
} from '@/lib/validation';
import { isValidTimeZone, utcToZoned } from '@/lib/zoned-time';

import { asString, type JsonSchema, type ToolContext, type ToolDefinition, ToolRefusal } from '../types';
import {
  audit,
  changedFields,
  localStamp,
  matches,
  optAmount,
  optCurrency,
  optDate,
  optEnum,
  optFlag,
  optId,
  optText,
  optTime,
  parseWith,
  reqId,
  reqText,
  requireChange,
  toUtc,
  unwrap,
} from './_shared';

const MODULE = 'trip-planning';
const PAGE_SIZE = 20;
/** A long trip's events are read a day at a time past this many. */
const MAX_EVENTS = 80;

const CATEGORIES = ['transportation', 'flight', 'lodging', 'activity', 'tour', 'booking', 'information'] as const;
type Category = (typeof CATEGORIES)[number];

/** The older `itemType` column still read by reports; it follows from the category, as on the trip page. */
const LEGACY_TYPE: Record<Category, NonNullable<TripItineraryItemDraft['itemType']>> = {
  flight: 'flight',
  transportation: 'car',
  lodging: 'hotel',
  tour: 'activity',
  booking: 'activity',
  activity: 'activity',
  information: 'location',
};

const REMINDERS = ['5', '15', '30', '60', '1440'];

const tripHref = (id: number) => `/modules/trip-planning/${id}`;
const day10 = (iso: string | null) => (iso ? iso.slice(0, 10) : null);
const clip = (text: string | null, max: number) => (text && text.length > max ? `${text.slice(0, max)}…` : text);

/** Which of an event's crew are still to be assigned (the summary carries the people, not their ids). */
function gapsOf(item: TripItineraryItemSummary) {
  return crewGaps({
    category: item.category,
    driverId: item.driver?.id ?? null,
    officerId: item.officer?.id ?? null,
    vehicleId: item.vehicle?.id ?? null,
    details: item.details,
  });
}

async function loadTrip(tripId: number, ctx: ToolContext): Promise<TripDetail> {
  const trip = await getTripForUser({ id: tripId, userId: ctx.userId, isAdmin: ctx.isAdmin });
  if (!trip) throw new ToolRefusal(`Trip ${tripId} was not found, or this user cannot see it. Find it with find_trips.`);
  return tripForViewer(trip, ctx.user);
}

/** The zone an event's clock time is written in: a flight's airport, otherwise where the user is. */
function zoneOf(item: Pick<TripItineraryItemSummary, 'category' | 'details'>, ctx: ToolContext): string {
  const saved = item.details?.timezone;
  return item.category === 'flight' && saved && isValidTimeZone(saved) ? saved : ctx.timeZone;
}

function eventView(item: TripItineraryItemSummary, ctx: ToolContext) {
  const zone = zoneOf(item, ctx);
  const details = Object.fromEntries(Object.entries(item.details ?? {}).filter(([, value]) => value));
  const gaps = gapsOf(item);
  return {
    eventId: item.id,
    dayId: item.dayId,
    category: item.category,
    timeLabel: item.timeLabel,
    title: item.description,
    when: localStamp(item.scheduledAt, zone),
    ends: localStamp(item.endsAt, zone),
    ...(zone !== ctx.timeZone ? { timeZone: zone } : {}),
    place: item.placeName,
    address: item.address,
    provider: item.providerName,
    confirmationCode: item.confirmationCode,
    notes: clip(item.body, 300),
    ...(Object.keys(details).length > 0 ? { details } : {}),
    driver: item.driver ? { id: item.driver.id, name: item.driver.name } : null,
    officer: item.officer ? { id: item.officer.id, name: item.officer.name } : null,
    vehicle: item.vehicle ? { id: item.vehicle.id, registration: item.vehicle.registration } : null,
    travellers: item.travelers.map((t) => t.name),
    done: Boolean(item.completedAt),
    ...(item.unitPrice != null ? { cost: item.unitPrice } : {}),
    ...(gaps.length > 0 ? { crewMissing: crewGapLabel(gaps) } : {}),
  };
}

/** The handful of facts that identify an event, for results and diffs. */
function eventFacts(item: TripItineraryItemSummary, ctx: ToolContext): Record<string, unknown> {
  const view = eventView(item, ctx);
  return {
    dayId: view.dayId,
    category: view.category,
    timeLabel: view.timeLabel,
    title: view.title,
    when: view.when,
    ends: view.ends,
    place: view.place,
    address: view.address,
    provider: view.provider,
    confirmationCode: view.confirmationCode,
    notes: view.notes,
    details: 'details' in view ? view.details : null,
    driver: view.driver?.name ?? null,
    officer: view.officer?.name ?? null,
    vehicle: view.vehicle?.registration ?? null,
    travellers: view.travellers,
    done: view.done,
    cost: 'cost' in view ? view.cost : null,
  };
}

// --- Finding and reading ---------------------------------------------------------

const findTripsTool: ToolDefinition = {
  destructive: false,
  kind: 'read',
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'find_trips',
    description:
      'Find trips the user can see. Search by reference (e.g. BRG-ZAF-NOV-2668), tracking code, client task number, client or traveller name; filter by status; sort by start date. Returns ids for the other trip tools. 20 per page.',
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Reference, tracking code, task number, client or traveller name' },
        status: { type: 'string', enum: [...TRIP_STATUSES] },
        sort: { type: 'string', enum: [...TRIP_SORTS], description: 'updated (default), start-asc (what starts next), start-desc' },
        page: { type: 'integer' },
      },
    },
  },
  async handler(args, ctx) {
    const page = optAmount(args, 'page', { min: 1, integer: true }) ?? 1;
    const result = await searchTrips({
      userId: ctx.userId,
      isAdmin: ctx.isAdmin,
      q: asString(args.q) ?? null,
      status: optEnum(args, 'status', TRIP_STATUSES) ?? null,
      sort: (optEnum(args, 'sort', TRIP_SORTS) as TripSort | undefined) ?? null,
      page,
      pageSize: PAGE_SIZE,
    });
    return {
      total: result.total,
      page: result.page,
      more: result.page * result.pageSize < result.total,
      trips: result.trips.map((trip) => ({
        id: trip.id,
        reference: trip.reference,
        trackingCode: trip.trackingCode,
        taskNumber: trip.title,
        status: trip.status,
        client: trip.customer.name,
        country: trip.country,
        start: day10(trip.startDate),
        end: day10(trip.endDate),
        leadTraveller: trip.travelers.find((t) => t.isPrimary)?.name ?? trip.travelers[0]?.name ?? null,
        events: trip.itemCount,
        href: tripHref(trip.id),
      })),
    };
  },
};

const getTripTool: ToolDefinition = {
  destructive: false,
  kind: 'read',
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'get_trip',
    description:
      'Open one trip: its details, travellers, itinerary days and every event with its id, time, place, crew and status. Call this before changing a trip or its itinerary. Pass `date` to read one day of a long trip.',
    parameters: {
      type: 'object',
      properties: {
        tripId: { type: 'integer' },
        date: { type: 'string', description: 'YYYY-MM-DD: only that day\'s events' },
      },
      required: ['tripId'],
    },
  },
  async handler(args, ctx) {
    const trip = await loadTrip(reqId(args, 'tripId', 'use find_trips'), ctx);
    const date = optDate(args, 'date');
    const dayIds = date ? new Set(trip.days.filter((day) => day.dateKey === date).map((day) => day.id)) : null;
    const wanted = dayIds ? trip.items.filter((item) => item.dayId !== null && dayIds.has(item.dayId)) : trip.items;
    const dayOrder = new Map(trip.days.map((day) => [day.id, day.dayNumber]));
    const ordered = [...wanted].sort(
      (a, b) =>
        (dayOrder.get(a.dayId ?? -1) ?? 9999) - (dayOrder.get(b.dayId ?? -1) ?? 9999) ||
        (a.scheduledAt ?? '9').localeCompare(b.scheduledAt ?? '9') ||
        a.position - b.position,
    );
    return {
      id: trip.id,
      reference: trip.reference,
      trackingCode: trip.trackingCode,
      taskNumber: trip.title,
      status: trip.status,
      client: { id: trip.customer.id, name: trip.customer.name },
      country: trip.country,
      currency: trip.currency,
      start: day10(trip.startDate),
      end: day10(trip.endDate),
      owner: trip.owner ? { id: trip.owner.id, name: trip.owner.name } : null,
      travellers: trip.travelers.map((t) => ({ travelerId: t.id, name: t.name, lead: t.isPrimary })),
      description: clip(trip.description, 1500),
      notes: clip(trip.notes, 800),
      days: trip.days.map((day) => ({
        dayId: day.id,
        day: day.dayNumber,
        date: day.dateKey,
        title: day.title,
        events: trip.items.filter((item) => item.dayId === day.id).length,
      })),
      unscheduledEvents: trip.items.filter((item) => item.dayId === null).length,
      events: ordered.slice(0, MAX_EVENTS).map((item) => eventView(item, ctx)),
      ...(ordered.length > MAX_EVENTS
        ? { note: `Showing the first ${MAX_EVENTS} of ${ordered.length} events. Pass a date to read one day.` }
        : {}),
      timesShownIn: ctx.timeZone,
      ...(trip.costsHidden ? { costs: 'hidden (this user cannot see quote prices)' } : {}),
      href: tripHref(trip.id),
    };
  },
};

const CREW_KINDS = ['drivers', 'officers', 'vehicles'] as const;
const CREW_SHOWN = 12;

/**
 * The same registers the trip page's crew pickers read, so whoever can plan a
 * trip can crew it from chat without holding Task Assignment as well.
 */
const findTripCrewTool: ToolDefinition = {
  destructive: false,
  kind: 'read',
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'find_trip_crew',
    description:
      "Find drivers, close protection officers and vehicles to put on a trip's events, by name, call sign or number plate. Returns their ids, whether they are already allocated to this trip, and another trip they are busy on. With no q, lists who is allocated to the trip.",
    parameters: {
      type: 'object',
      properties: {
        tripId: { type: 'integer' },
        q: { type: 'string', description: 'Name, call sign or plate' },
        kind: { type: 'string', enum: [...CREW_KINDS] },
      },
      required: ['tripId'],
    },
  },
  async handler(args, ctx) {
    const trip = await loadTrip(reqId(args, 'tripId', 'use find_trips'), ctx);
    const q = asString(args.q);
    const kind = optEnum(args, 'kind', CREW_KINDS);
    const options = await listCrewOptions(trip.id);
    const idKey = { drivers: 'driverId', officers: 'officerId', vehicles: 'vehicleId' } as const;
    const out: Record<string, unknown> = { reference: trip.reference };
    let found = 0;
    for (const key of CREW_KINDS) {
      if (kind && kind !== key) continue;
      const all: CrewOption[] = options[key];
      const rows = q ? all.filter((row) => matches(q, row.label, row.hint)) : kind ? all : all.filter((row) => row.onTrip);
      found += rows.length;
      out[key] = rows.slice(0, CREW_SHOWN).map((row) => ({
        [idKey[key]]: row.id,
        name: row.label,
        details: row.hint,
        status: row.status,
        ...(row.onTrip ? { allocatedToThisTrip: true } : {}),
        ...(row.busyOn ? { busyOn: row.busyOn } : {}),
      }));
      if (rows.length > CREW_SHOWN) out[`${key}More`] = `${rows.length} match; narrow with q`;
    }
    if (found === 0) {
      out.note = q
        ? `Nobody and nothing in the crew registers matches "${q}".`
        : 'Nothing is allocated to this trip yet. Search with q (a name or plate).';
    }
    return out;
  },
};

// --- The trip itself -------------------------------------------------------------

const createTripTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'create_trip',
    description:
      'Create a trip for a client. Find the client id with search_platform. ' +
      "The reference is made from the client's code, the country, the start month and the next number. A trip with dates opens with one itinerary day per date.",
    parameters: {
      type: 'object',
      properties: {
        customerId: { type: 'integer' },
        country: { type: 'string', enum: [...SERVICE_COUNTRIES], description: 'Where the trip is' },
        title: { type: 'string', description: "The client's task number, or a short name" },
        description: { type: 'string' },
        startDate: { type: 'string', description: 'YYYY-MM-DD' },
        endDate: { type: 'string', description: 'YYYY-MM-DD' },
        currency: { type: 'string', description: '3-letter code, default USD' },
      },
      required: ['customerId', 'country', 'title'],
    },
  },
  async handler(args, ctx) {
    const customerId = reqId(args, 'customerId', 'find the client with search_platform');
    if (!isServiceCountry(args.country)) throw new ToolRefusal(`country must be one of: ${SERVICE_COUNTRIES.join(', ')}.`);
    const startDate = optDate(args, 'startDate') ?? null;
    const endDate = optDate(args, 'endDate') ?? null;
    if (startDate && endDate && endDate < startDate) throw new ToolRefusal('endDate is before startDate.');
    const trip = await createTrip({
      customerId,
      country: args.country,
      ownerId: ctx.userId,
      title: reqText(args, 'title', { max: 200 }),
      description: optText(args, 'description', { max: 10000 }) ?? null,
      startDate,
      endDate,
      currency: optCurrency(args) ?? 'USD',
      notes: null,
      items: [],
      createdById: ctx.userId,
    });
    await audit({
      action: 'trip.created',
      entityType: 'trip',
      entityId: String(trip.id),
      actorUserId: ctx.userId,
      metadata: { reference: trip.reference, trackingCode: trip.trackingCode, via: 'assistant' },
      request: ctx.request,
    });
    return {
      id: trip.id,
      reference: trip.reference,
      status: trip.status,
      start: day10(trip.startDate),
      end: day10(trip.endDate),
      days: trip.days.length,
      href: tripHref(trip.id),
      summary: `Created trip ${trip.reference}`,
    };
  },
};

const tripFacts = (trip: TripDetail): Record<string, unknown> => ({
  title: trip.title,
  status: trip.status,
  startDate: day10(trip.startDate),
  endDate: day10(trip.endDate),
  currency: trip.currency,
  country: trip.country,
  owner: trip.owner?.name ?? null,
  client: trip.customer.name,
  travellers: trip.travelers.map((t) => t.name),
  description: trip.description,
  notes: trip.notes,
});

const TRIP_FIELDS = Object.keys({
  title: 1, status: 1, startDate: 1, endDate: 1, currency: 1, country: 1, owner: 1, client: 1, travellers: 1, description: 1, notes: 1,
});

/** New text for a long field: joined to what is there, or in its place, as the caller said. */
function mergeText(args: Record<string, unknown>, key: 'description' | 'notes', current: string | null): string | null | undefined {
  const text = optText(args, key, { max: 10000 });
  if (text === undefined) return undefined;
  const modeKey = `${key}Mode`;
  const mode = optEnum(args, modeKey, ['append', 'replace'] as const);
  if (!mode) {
    throw new ToolRefusal(
      `Say how to apply the ${key}: ${modeKey} "append" adds it under the existing text, "replace" discards what is there${
        current ? ` (${current.length} characters now)` : ''
      }.`,
    );
  }
  if (text === null) return null;
  return mode === 'append' && current ? `${current.trimEnd()}\n\n${text}` : text;
}

const updateTripTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'update_trip',
    description:
      "Change a trip's own details: task number (title), status, dates, currency, country, owner, travellers, description, notes. " +
      'NOT for the itinerary: pickups, transfers, flights, hotels, activities, times, places and crew are events — use save_trip_event. ' +
      'Send only what should change. Changing dates does not add or remove itinerary days.',
    parameters: {
      type: 'object',
      properties: {
        tripId: { type: 'integer' },
        title: { type: 'string', description: "The client's task number" },
        status: { type: 'string', enum: [...TRIP_STATUSES] },
        startDate: { type: 'string', description: 'YYYY-MM-DD; null clears it', nullable: true },
        endDate: { type: 'string', description: 'YYYY-MM-DD; null clears it', nullable: true },
        currency: { type: 'string', description: '3-letter code' },
        country: { type: 'string', enum: [...SERVICE_COUNTRIES] },
        ownerId: { type: 'integer', description: 'User id of the trip owner; null clears it', nullable: true },
        description: { type: 'string', description: 'Trip description (supports **bold**, _italic_, "- " lists); null clears it', nullable: true },
        descriptionMode: { type: 'string', enum: ['append', 'replace'], description: 'Required with description' },
        notes: { type: 'string', description: 'Internal notes; null clears them', nullable: true },
        notesMode: { type: 'string', enum: ['append', 'replace'], description: 'Required with notes' },
        travelers: {
          type: 'array',
          description: "Replaces who is on the trip, lead first. Each is an existing traveller of the client (travelerId) or a new one to add (name).",
          items: { type: 'object', properties: { travelerId: { type: 'integer' }, name: { type: 'string' } } },
        },
      },
      required: ['tripId'],
    },
  },
  async handler(args, ctx) {
    const id = reqId(args, 'tripId', 'use find_trips');
    const before = await loadTrip(id, ctx);

    const input: Record<string, unknown> = {};
    const title = optText(args, 'title', { max: 200 });
    if (title != null) input.title = title;
    const status = optEnum(args, 'status', TRIP_STATUSES);
    if (status) input.status = status;
    for (const key of ['startDate', 'endDate'] as const) {
      const value = optDate(args, key);
      if (value !== undefined) input[key] = value;
    }
    const currency = optCurrency(args);
    if (currency) input.currency = currency;
    if (args.country !== undefined) {
      if (!isServiceCountry(args.country)) throw new ToolRefusal(`country must be one of: ${SERVICE_COUNTRIES.join(', ')}.`);
      input.country = args.country;
    }
    const ownerId = optId(args, 'ownerId');
    if (ownerId !== undefined) input.ownerId = ownerId;
    const description = mergeText(args, 'description', before.description);
    if (description !== undefined) input.description = description;
    const notes = mergeText(args, 'notes', before.notes);
    if (notes !== undefined) input.notes = notes;
    if (args.travelers !== undefined) input.travelers = args.travelers;

    if (Object.keys(input).length === 0) throw new ToolRefusal('Say what to change on the trip.');
    const start = 'startDate' in input ? (input.startDate as string | null) : day10(before.startDate);
    const end = 'endDate' in input ? (input.endDate as string | null) : day10(before.endDate);
    if (start && end && end < start) throw new ToolRefusal(`The end date (${end}) would be before the start date (${start}).`);

    const data = parseWith(tripUpdateSchema, input) as TripUpdateInput & { status?: TripStatus };
    const after = unwrap(await updateTrip({ id, userId: ctx.userId, isAdmin: ctx.isAdmin, input: data }));

    const changed = changedFields(tripFacts(before), tripFacts(after), TRIP_FIELDS);
    requireChange(changed, `trip ${before.reference}`);
    for (const key of ['description', 'notes'] as const) {
      if (changed[key]) changed[key] = { from: clip(before[key], 120), to: clip(after[key], 120) };
    }

    const metadata = { reference: after.reference, trackingCode: after.trackingCode, via: 'assistant' };
    if (changed.status) {
      await audit({
        action: 'trip.status.changed',
        entityType: 'trip',
        entityId: String(id),
        actorUserId: ctx.userId,
        metadata: { ...metadata, from: before.status, to: after.status },
        request: ctx.request,
      });
    }
    if (!changed.status || Object.keys(changed).length > 1) {
      await audit({ action: 'trip.updated', entityType: 'trip', entityId: String(id), actorUserId: ctx.userId, metadata, request: ctx.request });
    }
    return {
      id,
      reference: after.reference,
      changed,
      href: tripHref(id),
      summary: `Updated trip ${after.reference}: ${Object.keys(changed).join(', ')}`,
    };
  },
};

const deleteTripTool: ToolDefinition = {
  destructive: true,
  requiredModule: MODULE,
  confirmLabel: (args) => `Delete trip ${asString(args.reference) ?? `#${args.tripId}`} and its whole itinerary`,
  functionDeclaration: {
    name: 'delete_trip',
    description: 'Delete a draft or cancelled trip, with its itinerary. Cannot be undone.',
    parameters: {
      type: 'object',
      properties: {
        tripId: { type: 'integer' },
        reference: { type: 'string', description: "The trip's reference, shown to the user when they confirm" },
      },
      required: ['tripId'],
    },
  },
  async handler(args, ctx) {
    const id = reqId(args, 'tripId');
    const result = await deleteTrip({ id, userId: ctx.userId, isAdmin: ctx.isAdmin });
    if (result !== true) return { error: result.error };
    await audit({
      action: 'trip.deleted',
      entityType: 'trip',
      entityId: String(id),
      actorUserId: ctx.userId,
      metadata: { via: 'assistant' },
      request: ctx.request,
    });
    return { deleted: true, tripId: id, summary: `Deleted trip ${asString(args.reference) ?? `#${id}`}` };
  },
};

// --- Itinerary events --------------------------------------------------------------

const detailProperties: Record<string, JsonSchema> = Object.fromEntries(
  [...new Set(Object.values(tripItemDetailKeys).flat())]
    // The catalogue service and its code are picked on the trip page, with the staged resource they draw on.
    .filter((key) => key !== 'service' && key !== 'serviceCode' && key !== 'timezone')
    .map((key) => [key, { type: 'string' }]),
);

const eventProperties: Record<string, JsonSchema> = {
  category: {
    type: 'string',
    enum: [...CATEGORIES],
    description: 'transportation = a pickup, drop-off or transfer; lodging = a hotel; information = a note on the itinerary',
  },
  title: { type: 'string', description: 'What the card says, e.g. "Airport pickup · OR Tambo to Sandton" (max 280)' },
  timeLabel: {
    type: 'string',
    description:
      'What the time means: PICK-UP, DROP-OFF (transportation); DEPARTURE, ARRIVAL (flight); CHECK-IN, CHECK-OUT (lodging); START, MEET, END, ALL DAY',
  },
  date: {
    type: 'string',
    description: 'YYYY-MM-DD. The event goes on that day of the itinerary (the day is added if the trip has none for it); null unschedules it',
    nullable: true,
  },
  time: { type: 'string', description: '24-hour HH:MM, in the user\'s time zone; for a flight, local time at the airport' },
  endTime: { type: 'string', description: '24-hour HH:MM on the same date' },
  durationMinutes: { type: 'integer' },
  placeName: { type: 'string' },
  address: { type: 'string' },
  providerName: { type: 'string', description: 'Airline, hotel brand, operator' },
  phone: { type: 'string' },
  bookingUrl: { type: 'string' },
  confirmationCode: { type: 'string' },
  notes: { type: 'string', description: 'Free text shown on the event' },
  details: {
    type: 'object',
    description:
      'Fields of the category. transportation: mode, pickupLocation, dropoffLocation, vehicle, driverName, driverPhone, distanceKm. ' +
      'flight: flightNumber, cabin, departAirport, arriveAirport (IATA codes), terminal, gate, seat, baggage. ' +
      'lodging: roomType, nights, guests, checkInTime, checkOutTime, boardBasis. tour: meetingPoint, durationText, groupSize, languages, guideName, inclusions. ' +
      'booking: bookingRef, ticketType, partySize, dressCode. activity: durationText, whatToBring.',
    properties: detailProperties,
  },
  driverId: { type: 'integer', description: 'From find_trip_crew; null takes the driver off', nullable: true },
  officerId: { type: 'integer', description: 'Close protection officer, from find_trip_crew; null takes them off', nullable: true },
  vehicleId: { type: 'integer', description: 'From find_trip_crew; null takes it off', nullable: true },
  travelerIds: {
    type: 'array',
    description: "Which of the trip's travellers the event is for (travelerId from get_trip). Empty means the whole party.",
    items: { type: 'integer' },
  },
  reminderMinutesBefore: { type: 'string', enum: REMINDERS, description: 'Minutes before the event; null removes the reminder', nullable: true },
  cost: { type: 'number', description: 'Cost of the event in the trip currency (needs access to quotes)' },
  done: { type: 'boolean', description: 'Mark an existing event completed (true) or not (false)' },
};

/** Loose event arguments as the fields the trip page would send; only those given are present. */
function readEventFields(
  args: Record<string, unknown>,
  ctx: ToolContext,
  current: {
    category: Category;
    timeLabel: string | null;
    details: Record<string, string> | null;
    date: string | null;
    time: string | null;
    zone: string;
  },
): { fields: TripItineraryItemUpdateInput; date: string | null | undefined } {
  const fields: TripItineraryItemUpdateInput = {};
  const category = optEnum(args, 'category', CATEGORIES) ?? current.category;
  if (args.category !== undefined) {
    fields.category = category;
    fields.itemType = LEGACY_TYPE[category];
  }

  const title = optText(args, 'title', { max: 280 });
  if (title != null) fields.description = title;
  const text = (key: string, to: keyof TripItineraryItemUpdateInput, max: number) => {
    const value = optText(args, key, { max });
    if (value !== undefined) (fields as Record<string, unknown>)[to] = value;
  };
  text('timeLabel', 'timeLabel', 40);
  text('placeName', 'placeName', 200);
  text('address', 'address', 400);
  text('providerName', 'providerName', 160);
  text('phone', 'phone', 60);
  text('bookingUrl', 'bookingUrl', 2048);
  text('confirmationCode', 'confirmationCode', 100);
  text('notes', 'body', 6000);

  let details = current.details ? { ...current.details } : {};
  if (args.details !== undefined) {
    const given = (args.details ?? {}) as Record<string, unknown>;
    const allowed = tripItemDetailKeys[category];
    for (const [key, raw] of Object.entries(given)) {
      if (!allowed.includes(key)) {
        throw new ToolRefusal(`"${key}" is not a field of a ${category} event (it takes: ${allowed.filter((k) => !k.startsWith('service') && k !== 'timezone').join(', ')}).`);
      }
      const value = asString(raw);
      if (value) details[key] = value;
      else delete details[key];
    }
  }
  // Changing the category leaves behind whatever the new one has no field for.
  if (args.category !== undefined) {
    details = Object.fromEntries(Object.entries(details).filter(([key]) => tripItemDetailKeys[category].includes(key)));
  }

  // When: a date picks the day; a date and a time make the moment.
  const date = optDate(args, 'date');
  const time = optTime(args, 'time');
  const endTime = optTime(args, 'endTime');
  let zone = current.zone;
  if (category === 'flight') {
    const arrival = (fields.timeLabel ?? current.timeLabel ?? '').toUpperCase() === 'ARRIVAL';
    zone = airportTimeZone(arrival ? details.arriveAirport : details.departAirport) ?? zone;
    details.timezone = zone;
  }
  const onDate = date === undefined ? current.date : date;
  const atTime = time === undefined ? current.time : time;
  if (date !== undefined || time !== undefined) {
    if (!onDate) {
      if (atTime) throw new ToolRefusal('A time needs a date: give `date` as well.');
      fields.scheduledAt = null;
    } else {
      // A day with no time sits at 09:00, as it does when added on the trip page.
      fields.scheduledAt = toUtc(onDate, atTime ?? '09:00', zone, 'event time');
    }
  }
  if (endTime !== undefined) {
    if (endTime === null) fields.endsAt = null;
    else {
      if (!onDate) throw new ToolRefusal('An end time needs a date: give `date` as well.');
      fields.endsAt = toUtc(onDate, endTime, zone, 'end time');
      if (atTime && endTime < atTime) throw new ToolRefusal('endTime is before time. An event that runs past midnight needs durationMinutes instead.');
    }
  }
  const duration = optAmount(args, 'durationMinutes', { min: 0, max: 60 * 24 * 30, integer: true });
  if (duration !== undefined) fields.durationMinutes = duration;

  if (args.details !== undefined || args.category !== undefined || (category === 'flight' && (date !== undefined || time !== undefined))) {
    fields.details = Object.keys(details).length > 0 ? details : null;
  }

  for (const key of ['driverId', 'officerId', 'vehicleId'] as const) {
    const value = optId(args, key);
    if (value !== undefined) fields[key] = value;
  }
  if (args.travelerIds !== undefined) {
    fields.travelers = (args.travelerIds as unknown[]).map((raw) => {
      const travelerId = Number(raw);
      if (!Number.isInteger(travelerId) || travelerId <= 0) throw new ToolRefusal('travelerIds must be traveller ids from get_trip.');
      return { travelerId };
    });
  }
  if (args.reminderMinutesBefore !== undefined) {
    fields.reminderMinutesBefore = args.reminderMinutesBefore === null ? null : Number(optEnum(args, 'reminderMinutesBefore', REMINDERS));
  }
  const cost = optAmount(args, 'cost', { min: 0, max: 100_000_000 });
  if (cost !== undefined) {
    if (!canSeeTripCosts(ctx.user)) throw new ToolRefusal('This user cannot see or set costs (that needs access to Quotes). Ask IT for permission.');
    fields.unitPrice = cost;
  }
  return { fields, date };
}

/** The itinerary day for a date, adding it in date order when the trip has none. */
async function dayForDate(trip: TripDetail, date: string, ctx: ToolContext): Promise<{ dayId: number; added: boolean }> {
  const existing = trip.days.find((day) => day.dateKey === date);
  if (existing) return { dayId: existing.id, added: false };
  const earlier = trip.days.filter((day) => day.dateKey && day.dateKey < date).sort((a, b) => b.dayNumber - a.dayNumber)[0];
  const hasLater = trip.days.some((day) => day.dateKey && day.dateKey > date);
  const after = unwrap(
    await createTripDay({
      tripId: trip.id,
      userId: ctx.userId,
      isAdmin: ctx.isAdmin,
      dateKey: date,
      ...(earlier ? { afterDayId: earlier.id } : hasLater ? { atStart: true } : {}),
    }),
  );
  const known = new Set(trip.days.map((day) => day.id));
  const created = after.days.find((day) => !known.has(day.id));
  if (!created) throw new ToolRefusal(`Could not add ${date} to the itinerary.`);
  await audit({
    action: 'trip.itinerary.day.added',
    entityType: 'trip',
    entityId: String(trip.id),
    actorUserId: ctx.userId,
    metadata: { reference: trip.reference, dayId: created.id, dateKey: date, via: 'assistant' },
    request: ctx.request,
  });
  return { dayId: created.id, added: true };
}

const EVENT_FIELDS = Object.keys({
  dayId: 1, category: 1, timeLabel: 1, title: 1, when: 1, ends: 1, place: 1, address: 1, provider: 1, confirmationCode: 1,
  notes: 1, details: 1, driver: 1, officer: 1, vehicle: 1, travellers: 1, done: 1, cost: 1,
});

async function addEvent(args: Record<string, unknown>, trip: TripDetail, ctx: ToolContext) {
  const category = optEnum(args, 'category', CATEGORIES);
  if (!category) throw new ToolRefusal(`A new event needs a category: ${CATEGORIES.join(', ')}.`);
  const title = reqText(args, 'title', { max: 280 });
  if (args.done !== undefined) throw new ToolRefusal('A new event cannot be added as done. Add it, then mark it done.');
  const { fields, date } = readEventFields(args, ctx, { category, timeLabel: null, details: null, date: null, time: null, zone: ctx.timeZone });

  const day = date ? await dayForDate(trip, date, ctx) : null;
  const draft = { ...fields, category, itemType: LEGACY_TYPE[category], description: title, quantity: 1, dayId: day?.dayId ?? null };
  const { items } = parseWith(tripItineraryItemAddSchema, { items: [draft] });
  const known = new Set(trip.items.map((item) => item.id));
  const after = unwrap(
    await addTripItems({ tripId: trip.id, userId: ctx.userId, isAdmin: ctx.isAdmin, items: items as TripItineraryItemDraft[] }),
  );
  const created = after.items.find((item) => !known.has(item.id));
  if (!created) throw new ToolRefusal('The event was not saved.');

  await audit({
    action: 'trip.itinerary.item.added',
    entityType: 'trip',
    entityId: String(trip.id),
    actorUserId: ctx.userId,
    metadata: { reference: after.reference, trackingCode: after.trackingCode, addedCount: 1, itemId: created.id, via: 'assistant' },
    request: ctx.request,
  });
  const view = eventView(created, ctx);
  const outside =
    date && ((trip.startDate && date < day10(trip.startDate)!) || (trip.endDate && date > day10(trip.endDate)!))
      ? `${date} is outside the trip's dates (${day10(trip.startDate)} to ${day10(trip.endDate)}); the trip's dates were not changed.`
      : null;
  return {
    tripId: trip.id,
    eventId: created.id,
    reference: after.reference,
    added: view,
    ...(day?.added ? { dayAdded: date } : {}),
    ...(outside ? { note: outside } : {}),
    href: tripHref(trip.id),
    summary: `Added "${created.description}" to ${after.reference}${view.when ? ` on ${view.when}` : ' (unscheduled)'}`,
  };
}

async function changeEvent(args: Record<string, unknown>, eventId: number, trip: TripDetail, ctx: ToolContext) {
  const item = trip.items.find((candidate) => candidate.id === eventId);
  if (!item) throw new ToolRefusal(`Event ${eventId} is not on trip ${trip.reference}. Read the itinerary with get_trip.`);

  const zone = zoneOf(item, ctx);
  const local = item.scheduledAt ? utcToZoned(item.scheduledAt, zone) : { date: '', time: '' };
  const { fields, date } = readEventFields(args, ctx, {
    category: item.category as Category,
    timeLabel: item.timeLabel,
    details: item.details,
    date: local.date || null,
    time: local.time || null,
    zone,
  });
  if (date === null) fields.dayId = null;
  else if (date !== undefined) fields.dayId = (await dayForDate(trip, date, ctx)).dayId;
  const done = optFlag(args, 'done');
  if (done !== undefined) fields.completed = done;

  if (Object.keys(fields).length === 0) throw new ToolRefusal('Say what to change on the event.');
  const input = parseWith(tripItineraryItemUpdateSchema, fields) as TripItineraryItemUpdateInput;
  const after = unwrap(await updateTripItem({ tripId: trip.id, itemId: eventId, userId: ctx.userId, isAdmin: ctx.isAdmin, input }));
  const updated = after.items.find((candidate) => candidate.id === eventId)!;

  const changed = changedFields(eventFacts(item, ctx), eventFacts(updated, ctx), EVENT_FIELDS);
  requireChange(changed, `"${item.description}"`);
  await audit({
    action: done === true ? 'trip.itinerary.item.completed' : 'trip.itinerary.item.updated',
    entityType: 'trip',
    entityId: String(trip.id),
    actorUserId: ctx.userId,
    metadata: { reference: after.reference, trackingCode: after.trackingCode, itemId: eventId, via: 'assistant' },
    request: ctx.request,
  });
  const gaps = gapsOf(updated);
  return {
    tripId: trip.id,
    eventId,
    reference: after.reference,
    title: updated.description,
    changed,
    ...(gaps.length > 0 ? { crewMissing: crewGapLabel(gaps) } : {}),
    href: tripHref(trip.id),
    summary: `Updated "${updated.description}" on ${after.reference}: ${Object.keys(changed).join(', ')}`,
  };
}

/**
 * One tool for adding and changing, because the two take the same thirty
 * fields and every declaration is paid for on every step of a conversation.
 */
const saveTripEventTool: ToolDefinition = {
  destructive: false,
  kind: 'write',
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'save_trip_event',
    description:
      "Add an event to a trip's itinerary, or change one. An event is a pickup, drop-off or transfer (transportation), a flight, a hotel stay (lodging), an activity, tour, booking or information note. " +
      'To ADD: leave eventId out; give category and title, and the date, time, places and crew if known. ' +
      'To CHANGE: give eventId (from get_trip) and only what should change: time, date, place, title, details, crew, travellers, or done. ' +
      'Crew ids come from find_trip_crew. An event saved without crew is kept and the desk is told what is missing.',
    parameters: {
      type: 'object',
      properties: {
        tripId: { type: 'integer' },
        eventId: { type: 'integer', description: 'Give it to change that event; leave it out to add a new one' },
        ...eventProperties,
      },
      required: ['tripId'],
    },
  },
  async handler(args, ctx) {
    const trip = await loadTrip(reqId(args, 'tripId', 'use find_trips'), ctx);
    const eventId = optId(args, 'eventId');
    return eventId ? changeEvent(args, eventId, trip, ctx) : addEvent(args, trip, ctx);
  },
};

const deleteTripEventTool: ToolDefinition = {
  destructive: true,
  requiredModule: MODULE,
  confirmLabel: (args) =>
    `Delete the event ${asString(args.title) ? `"${asString(args.title)}"` : `#${args.eventId}`} from trip ${asString(args.reference) ?? `#${args.tripId}`}`,
  functionDeclaration: {
    name: 'delete_trip_event',
    description: "Remove one event from a trip's itinerary. Cannot be undone.",
    parameters: {
      type: 'object',
      properties: {
        tripId: { type: 'integer' },
        eventId: { type: 'integer' },
        title: { type: 'string', description: "The event's title, shown to the user when they confirm" },
        reference: { type: 'string', description: "The trip's reference, shown to the user when they confirm" },
      },
      required: ['tripId', 'eventId'],
    },
  },
  async handler(args, ctx) {
    const tripId = reqId(args, 'tripId');
    const eventId = reqId(args, 'eventId');
    const trip = await loadTrip(tripId, ctx);
    const item = trip.items.find((candidate) => candidate.id === eventId);
    if (!item) throw new ToolRefusal(`Event ${eventId} is not on trip ${trip.reference}.`);
    const after = unwrap(await deleteTripItem({ tripId, itemId: eventId, userId: ctx.userId, isAdmin: ctx.isAdmin }));
    await audit({
      action: 'trip.itinerary.item.removed',
      entityType: 'trip',
      entityId: String(tripId),
      actorUserId: ctx.userId,
      metadata: { reference: after.reference, trackingCode: after.trackingCode, itemId: eventId, via: 'assistant' },
      request: ctx.request,
    });
    return {
      deleted: true,
      tripId,
      eventId,
      reference: after.reference,
      href: tripHref(tripId),
      summary: `Deleted "${item.description}" from ${after.reference}`,
    };
  },
};

// --- Itinerary days ----------------------------------------------------------------

const addTripDayTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'add_trip_day',
    description: "Add a day to a trip's itinerary. With a date it is placed in date order; without one it goes at the end. (save_trip_event adds the day itself when it needs one.)",
    parameters: {
      type: 'object',
      properties: {
        tripId: { type: 'integer' },
        date: { type: 'string', description: 'YYYY-MM-DD' },
        title: { type: 'string', description: 'e.g. "Arrival day"' },
      },
      required: ['tripId'],
    },
  },
  async handler(args, ctx) {
    const tripId = reqId(args, 'tripId', 'use find_trips');
    const trip = await loadTrip(tripId, ctx);
    const date = optDate(args, 'date') ?? null;
    if (date && trip.days.some((day) => day.dateKey === date)) {
      throw new ToolRefusal(`The itinerary already has a day for ${date}.`);
    }
    const earlier = date
      ? trip.days.filter((day) => day.dateKey && day.dateKey < date).sort((a, b) => b.dayNumber - a.dayNumber)[0]
      : undefined;
    const input = parseWith(tripDayCreateSchema, {
      dateKey: date,
      title: optText(args, 'title', { max: 160 }) ?? null,
      ...(earlier ? { afterDayId: earlier.id } : date && trip.days.some((day) => day.dateKey && day.dateKey > date) ? { atStart: true } : {}),
    });
    const after = unwrap(await createTripDay({ tripId, userId: ctx.userId, isAdmin: ctx.isAdmin, ...input }));
    const known = new Set(trip.days.map((day) => day.id));
    const created = after.days.find((day) => !known.has(day.id))!;
    await audit({
      action: 'trip.itinerary.day.added',
      entityType: 'trip',
      entityId: String(tripId),
      actorUserId: ctx.userId,
      metadata: { reference: after.reference, dayId: created.id, via: 'assistant' },
      request: ctx.request,
    });
    return {
      tripId,
      reference: after.reference,
      dayId: created.id,
      day: created.dayNumber,
      date: created.dateKey,
      href: tripHref(tripId),
      summary: `Added day ${created.dayNumber}${created.dateKey ? ` (${created.dateKey})` : ''} to ${after.reference}`,
    };
  },
};

const updateTripDayTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'update_trip_day',
    description: "Change an itinerary day's title, summary or date. Get the dayId from get_trip.",
    parameters: {
      type: 'object',
      properties: {
        tripId: { type: 'integer' },
        dayId: { type: 'integer' },
        title: { type: 'string', description: 'null clears it', nullable: true },
        summary: { type: 'string', description: 'null clears it', nullable: true },
        date: { type: 'string', description: 'YYYY-MM-DD; null leaves the day undated', nullable: true },
      },
      required: ['tripId', 'dayId'],
    },
  },
  async handler(args, ctx) {
    const tripId = reqId(args, 'tripId', 'use find_trips');
    const dayId = reqId(args, 'dayId', 'use get_trip');
    const trip = await loadTrip(tripId, ctx);
    const before = trip.days.find((day) => day.id === dayId);
    if (!before) throw new ToolRefusal(`Day ${dayId} is not on trip ${trip.reference}.`);
    const date = optDate(args, 'date');
    if (date && trip.days.some((day) => day.id !== dayId && day.dateKey === date)) {
      throw new ToolRefusal(`Another day of the itinerary is already ${date}.`);
    }
    const input = parseWith(tripDayUpdateSchema, {
      title: optText(args, 'title', { max: 160 }),
      summary: optText(args, 'summary', { max: 4000 }),
      dateKey: date,
    });
    const after = unwrap(await updateTripDay({ tripId, dayId, userId: ctx.userId, isAdmin: ctx.isAdmin, ...input }));
    const updated = after.days.find((day) => day.id === dayId)!;
    const facts = (day: typeof before) => ({ title: day.title, summary: day.summary, date: day.dateKey });
    const changed = changedFields(facts(before), facts(updated), ['title', 'summary', 'date']);
    requireChange(changed, `day ${before.dayNumber}`);
    await audit({
      action: 'trip.itinerary.day.updated',
      entityType: 'trip',
      entityId: String(tripId),
      actorUserId: ctx.userId,
      metadata: { reference: after.reference, dayId, via: 'assistant' },
      request: ctx.request,
    });
    return {
      tripId,
      dayId,
      reference: after.reference,
      changed,
      href: tripHref(tripId),
      summary: `Updated day ${updated.dayNumber} of ${after.reference}: ${Object.keys(changed).join(', ')}`,
    };
  },
};

const deleteTripDayTool: ToolDefinition = {
  destructive: true,
  requiredModule: MODULE,
  confirmLabel: (args) =>
    `Delete day #${args.dayId} from trip ${asString(args.reference) ?? `#${args.tripId}`} (${
      args.events === 'delete' ? 'its events are deleted too' : 'its events are kept, unscheduled'
    })`,
  functionDeclaration: {
    name: 'delete_trip_day',
    description: "Remove a day from a trip's itinerary. Its events are kept and become unscheduled unless events is \"delete\".",
    parameters: {
      type: 'object',
      properties: {
        tripId: { type: 'integer' },
        dayId: { type: 'integer' },
        events: { type: 'string', enum: ['unschedule', 'delete'], description: 'What happens to the day\'s events (default unschedule)' },
        reference: { type: 'string', description: "The trip's reference, shown to the user when they confirm" },
      },
      required: ['tripId', 'dayId'],
    },
  },
  async handler(args, ctx) {
    const tripId = reqId(args, 'tripId');
    const dayId = reqId(args, 'dayId');
    const mode = optEnum(args, 'events', ['unschedule', 'delete'] as const) ?? 'unschedule';
    const trip = await loadTrip(tripId, ctx);
    const day = trip.days.find((candidate) => candidate.id === dayId);
    if (!day) throw new ToolRefusal(`Day ${dayId} is not on trip ${trip.reference}.`);
    const events = trip.items.filter((item) => item.dayId === dayId).length;
    const after = unwrap(await deleteTripDay({ tripId, dayId, userId: ctx.userId, isAdmin: ctx.isAdmin, mode }));
    await audit({
      action: 'trip.itinerary.day.deleted',
      entityType: 'trip',
      entityId: String(tripId),
      actorUserId: ctx.userId,
      metadata: { reference: after.reference, dayId, mode, via: 'assistant' },
      request: ctx.request,
    });
    return {
      deleted: true,
      tripId,
      dayId,
      reference: after.reference,
      events: mode === 'delete' ? `${events} deleted` : `${events} kept, now unscheduled`,
      href: tripHref(tripId),
      summary: `Deleted day ${day.dayNumber} from ${after.reference}`,
    };
  },
};

export const tripTools: ToolDefinition[] = [
  findTripsTool,
  getTripTool,
  findTripCrewTool,
  createTripTool,
  updateTripTool,
  saveTripEventTool,
  deleteTripEventTool,
  addTripDayTool,
  updateTripDayTool,
  deleteTripDayTool,
  deleteTripTool,
];
