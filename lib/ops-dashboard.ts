import 'server-only';

import type { Prisma } from '@prisma/client';

import {
  type FleetVehicleRef,
  type MaintenanceDisplayStatus,
  type MaintenanceDto,
  activeMaintenanceReminders,
  dateKeyToDate,
  isOpenMaintenance,
  localDateKey,
  maintenanceDisplayStatus,
  reminderMessage,
} from './fleet';
import { listFleetVehicles, listMaintenance, listVehicleOdometers } from './fleet-server';
import { getMapWorkspace } from './map-store';
import type { MapCategoryDto, MapDeviceTagDto, MapGeofenceDto, TrackedDevice } from './map-types';
import { listAccounts } from './messaging-accounts';
import { OPS_PANELS, type OpsPanelKey, PANEL_MODULE } from './ops-panels';
import { getOrganizationSettings } from './organization';
import { prisma } from './prisma';
import { ADMIN_ROLE_NAME } from './rbac';
import { type TrackedDevices, listTrackedDevices } from './tracked-devices';
import { buildAccessFilter, canEditTrip } from './trips';
import { type AccessUser, userHasModule, userHasRole } from './user';

/**
 * The Ops Dashboard: what the operations desk watches through the day. The
 * live map and the trackers on it, the trips under way and their flights,
 * shift handovers, tasks, the vehicle register, today's movements, the desk's
 * WhatsApp, and the fleet's fuel and maintenance.
 *
 * Each panel loads only for someone who holds its module (lib/ops-panels), with
 * the record rules that module applies: trips the viewer created or owns
 * (admins all), their own WhatsApp accounts, their own and shared tasks. The
 * board asks for just the panels it shows, and after a change just the panels
 * it touched. A panel that fails to load comes back empty rather than breaking
 * the board.
 */

const DAY = 86_400_000;
const HOUR = 3_600_000;

/** A desk following many trips at once sees them all on the board. */
const TRIP_LIMIT = 50;
const EVENTS_PER_TRIP = 40;
const ESCALATION_LIMIT = 5;
/** Escalated log entries stay on the board this long. */
const ESCALATION_WINDOW_MS = 24 * HOUR;
const MOVEMENT_LIMIT = 200;
/** Movements from the start of today up to this far ahead. */
const MOVEMENTS_AHEAD_MS = 24 * HOUR;
const FLIGHT_LIMIT = 15;
/** Flights from this long ago (still landing, just landed) up to this far ahead. */
const FLIGHTS_BEHIND_MS = 12 * HOUR;
const FLIGHTS_AHEAD_MS = 36 * HOUR;
const CHAT_LIMIT = 8;
const HANDOVER_WINDOW_MS = 7 * DAY;
const HANDOVER_LIMIT = 6;
const TASK_LIMIT = 8;
const FUEL_RECENT = 5;
const JOB_LIMIT = 8;
const COMING_DUE_LIMIT = 4;

// --- Shapes ------------------------------------------------------------------

/** One event of a trip's itinerary, between the start of today and a day ahead. */
export interface OpsTripEvent {
  id: number;
  category: string;
  description: string;
  timeLabel: string | null;
  scheduledAt: string;
  placeName: string | null;
  /** Driver, vehicle and officer on the event itself. */
  crew: string | null;
  flightNumber: string | null;
  completed: boolean;
}

export interface OpsTrip {
  id: number;
  reference: string;
  title: string;
  customer: string;
  status: string;
  country: string | null;
  startDate: string | null;
  endDate: string | null;
  /** Vehicle, driver and officer of the first live assignment. */
  crew: string | null;
  /** The assigned vehicle's registration on its own, for the board's row. */
  vehicle: string | null;
  /** Who controls it: the owner, or whoever created it. */
  controller: string | null;
  /** The viewer created or owns it. */
  mine: boolean;
  canEdit: boolean;
  /** Its itinerary from the start of today to a day ahead, in time order. */
  events: OpsTripEvent[];
  lastLog: { at: string; detail: string; escalated: boolean; by: string | null } | null;
}

export interface OpsEscalation {
  id: number;
  tripId: number;
  reference: string;
  country: string | null;
  detail: string;
  at: string;
  by: string | null;
}

export interface OpsTrips {
  active: number;
  startingSoon: number;
  trips: OpsTrip[];
  /** Log entries marked escalated in the last day. */
  escalations: OpsEscalation[];
}

/** One itinerary event between the start of today and a day ahead. */
export interface OpsMovement {
  id: number;
  tripId: number;
  reference: string;
  customer: string;
  country: string | null;
  category: string;
  description: string;
  timeLabel: string | null;
  scheduledAt: string;
  placeName: string | null;
  /** Driver, vehicle and officer on the event itself. */
  crew: string | null;
  flightNumber: string | null;
  completed: boolean;
  canEdit: boolean;
}

export interface OpsFlight {
  id: number;
  tripId: number;
  tripReference: string;
  tripTitle: string;
  customer: string;
  country: string | null;
  timeLabel: string | null;
  scheduledAt: string | null;
  endsAt: string | null;
  durationMinutes: number | null;
  airline: string | null;
  flightNumber: string | null;
  from: string | null;
  to: string | null;
  timezone: string | null;
  completed: boolean;
  /** May tick it off as handled (met, seen off), as on the trip. */
  canEdit: boolean;
}

export interface OpsChat {
  accountId: number;
  chatId: string;
  name: string;
  kind: 'dm' | 'group';
  lastMessageAt: string;
  unread: number;
  preview: { text: string; fromMe: boolean; senderName: string; mediaKind: string | null } | null;
}

export interface OpsWhatsapp {
  linked: boolean;
  unreadChats: number;
  chats: OpsChat[];
}

export interface OpsHandoverItem {
  id: number;
  shiftDate: string;
  shiftPeriod: string;
  post: string | null;
  status: string;
  summary: string;
  watchItems: string | null;
  author: string | null;
  createdAt: string;
  /** Written by the viewer, who can't acknowledge it. */
  mine: boolean;
}

export interface OpsHandover {
  /** Unacknowledged handovers from the last week. */
  awaiting: number;
  /** Urgent first, then attention, then the rest, newest first within each. */
  items: OpsHandoverItem[];
}

export interface OpsTask {
  id: number;
  title: string;
  priority: string;
  status: string;
  dueDate: string | null;
  /** Days until due, negative once overdue. */
  days: number | null;
  /** Someone else's task shared with the viewer: only its owner can tick it off. */
  shared: boolean;
}

export interface OpsTasks {
  open: number;
  overdue: number;
  tasks: OpsTask[];
}

export interface OpsFuelLog {
  id: number;
  vehicle: string;
  filledAt: string;
  litres: number;
  cost: number | null;
  currency: string;
  station: string | null;
}

export interface OpsFuel {
  /** The calendar month so far, as on the Car Fuel page. */
  month: { fills: number; litres: number; spend: Record<string, number> };
  recent: OpsFuelLog[];
}

export interface OpsJob {
  id: number;
  vehicle: string;
  kind: string;
  category: string;
  title: string;
  status: string;
  display: MaintenanceDisplayStatus;
  scheduledFor: string | null;
}

export interface OpsMaintenance {
  overdue: number;
  dueSoon: number;
  inProgress: number;
  /** Open work, most urgent first. */
  jobs: OpsJob[];
  /** Next services and inspections falling due on finished work. */
  comingDue: Array<{ key: string; maintenanceId: number; message: string; overdue: boolean }>;
}

/** The live trackers (Traccar and Zello), as the Map module shows them. */
export interface OpsTrackers {
  /** False when no tracking source is set up at all. */
  configured: boolean;
  /** A configured source that failed, e.g. an expired Traccar token. */
  error: string | null;
  devices: TrackedDevice[];
}

/** The trackers plus what the map draws around them. */
export interface OpsMap extends OpsTrackers {
  categories: MapCategoryDto[];
  geofences: MapGeofenceDto[];
  deviceTags: MapDeviceTagDto[];
}

/** The vehicle register by status: Available, Assigned, Maintenance, Off duty. */
export interface OpsVehicles {
  total: number;
  byStatus: { status: string; count: number }[];
}

export interface OpsSections {
  map: OpsMap;
  trackers: OpsTrackers;
  vehicles: OpsVehicles;
  movements: OpsMovement[];
  trips: OpsTrips;
  flights: OpsFlight[];
  whatsapp: OpsWhatsapp;
  handover: OpsHandover;
  tasks: OpsTasks;
  maintenance: OpsMaintenance;
  fuel: OpsFuel;
}

export interface OpsDashboard {
  generatedAt: string;
  /** The panels the viewer holds modules for. */
  allowed: OpsPanelKey[];
  /** The panels loaded this time: all allowed ones, or those asked for. */
  sections: Partial<OpsSections>;
  /** Where the Flights panel expands to: the tracker when they have it. */
  canOpenFlightTracker: boolean;
}

/** What the forms pick from. Sent with the page, not with every refresh. */
export interface OpsReference {
  vehicles: FleetVehicleRef[];
  defaultCurrency: string;
}

// --- Helpers -----------------------------------------------------------------

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysFrom(date: Date, from: Date): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - from.getTime()) / DAY);
}

async function safe<T>(label: string, work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    console.error(`[ops-dashboard] ${label} failed:`, error);
    return fallback;
  }
}

function text(details: Prisma.JsonValue | null, key: string): string | null {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null;
  const value = (details as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

type CrewRefs = {
  vehicle: { registration: string } | null;
  driver: { name: string } | null;
  officer: { name: string; callSign: string | null } | null;
};

function crewLine(crew: CrewRefs | undefined): string | null {
  if (!crew) return null;
  const officer = crew.officer ? `${crew.officer.name}${crew.officer.callSign ? ` (${crew.officer.callSign})` : ''}` : null;
  return [crew.vehicle?.registration, crew.driver?.name, officer].filter(Boolean).join(' · ') || null;
}

const CREW_SELECT = {
  vehicle: { select: { registration: true } },
  driver: { select: { name: true } },
  officer: { select: { name: true, callSign: true } },
} as const;

/** Trips the viewer can see that are planned or under way: the ones the board follows. */
function liveTrips(user: AccessUser, isAdmin: boolean): Prisma.TripWhereInput {
  return { AND: [buildAccessFilter(user.id, isAdmin), { status: { in: ['Planned', 'Active'] } }] };
}

// --- Trips -------------------------------------------------------------------

async function loadTrips(user: AccessUser, isAdmin: boolean): Promise<OpsTrips> {
  const today = startOfToday();
  const windowEnd = new Date(Date.now() + MOVEMENTS_AHEAD_MS);
  const inTwoDays = new Date(today.getTime() + 2 * DAY);
  const inWindow = { scheduledAt: { gte: today, lt: windowEnd } };
  // Under way; due to start within two days (or meant to have started and not yet ended);
  // or planned with something on the itinerary in the next day, whatever its dates say.
  const where: Prisma.TripWhereInput = {
    AND: [
      buildAccessFilter(user.id, isAdmin),
      {
        OR: [
          { status: 'Active' },
          { status: 'Planned', startDate: { lt: inTwoDays }, OR: [{ endDate: null }, { endDate: { gte: today } }] },
          { status: 'Planned', items: { some: inWindow } },
        ],
      },
    ],
  };

  const [rows, counts, escalations] = await Promise.all([
    prisma.trip.findMany({
      where,
      // "Active" sorts before "Planned".
      orderBy: [{ status: 'asc' }, { startDate: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
      take: TRIP_LIMIT,
      select: {
        id: true,
        reference: true,
        title: true,
        status: true,
        country: true,
        startDate: true,
        endDate: true,
        createdById: true,
        ownerId: true,
        customer: { select: { name: true } },
        owner: { select: { name: true } },
        createdBy: { select: { name: true } },
        assignments: {
          where: { status: { in: ['Planned', 'Confirmed', 'Active'] } },
          take: 1,
          select: CREW_SELECT,
        },
        items: {
          where: inWindow,
          orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
          take: EVENTS_PER_TRIP,
          select: {
            id: true,
            category: true,
            description: true,
            timeLabel: true,
            scheduledAt: true,
            placeName: true,
            details: true,
            completedAt: true,
            ...CREW_SELECT,
          },
        },
        logEntries: {
          orderBy: [{ loggedAt: 'desc' }, { id: 'desc' }],
          take: 1,
          select: { loggedAt: true, detail: true, escalated: true, dutyController: true },
        },
      },
    }),
    prisma.trip.groupBy({ by: ['status'], where, _count: { _all: true } }),
    prisma.tripLogEntry.findMany({
      where: {
        escalated: true,
        loggedAt: { gte: new Date(Date.now() - ESCALATION_WINDOW_MS) },
        trip: liveTrips(user, isAdmin),
      },
      orderBy: [{ loggedAt: 'desc' }, { id: 'desc' }],
      take: ESCALATION_LIMIT,
      select: {
        id: true,
        detail: true,
        loggedAt: true,
        dutyController: true,
        trip: { select: { id: true, reference: true, country: true } },
      },
    }),
  ]);

  const count = (status: string) => counts.find((c) => c.status === status)?._count._all ?? 0;
  return {
    active: count('Active'),
    startingSoon: count('Planned'),
    trips: rows.map((t) => {
      const log = t.logEntries[0];
      return {
        id: t.id,
        reference: t.reference,
        title: t.title,
        customer: t.customer.name,
        status: t.status,
        country: t.country,
        startDate: t.startDate?.toISOString() ?? null,
        endDate: t.endDate?.toISOString() ?? null,
        crew: crewLine(t.assignments[0]),
        vehicle: t.assignments[0]?.vehicle?.registration ?? null,
        controller: t.owner?.name ?? t.createdBy.name,
        mine: t.ownerId === user.id || t.createdById === user.id,
        canEdit: canEditTrip(t, user.id, isAdmin),
        events: t.items.map((it) => ({
          id: it.id,
          category: it.category,
          description: it.description,
          timeLabel: it.timeLabel,
          scheduledAt: it.scheduledAt!.toISOString(),
          placeName: it.placeName,
          crew: crewLine(it),
          flightNumber: it.category === 'flight' ? text(it.details, 'flightNumber') : null,
          completed: it.completedAt !== null,
        })),
        lastLog: log
          ? { at: log.loggedAt.toISOString(), detail: log.detail.slice(0, 200), escalated: log.escalated, by: log.dutyController }
          : null,
      };
    }),
    escalations: escalations.map((e) => ({
      id: e.id,
      tripId: e.trip.id,
      reference: e.trip.reference,
      country: e.trip.country,
      detail: e.detail.slice(0, 200),
      at: e.loggedAt.toISOString(),
      by: e.dutyController,
    })),
  };
}

// --- Movements ---------------------------------------------------------------

async function loadMovements(user: AccessUser, isAdmin: boolean): Promise<OpsMovement[]> {
  const rows = await prisma.tripItineraryItem.findMany({
    where: {
      scheduledAt: { gte: startOfToday(), lt: new Date(Date.now() + MOVEMENTS_AHEAD_MS) },
      trip: liveTrips(user, isAdmin),
    },
    orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
    take: MOVEMENT_LIMIT,
    select: {
      id: true,
      category: true,
      description: true,
      timeLabel: true,
      scheduledAt: true,
      placeName: true,
      details: true,
      completedAt: true,
      ...CREW_SELECT,
      trip: {
        select: { id: true, reference: true, country: true, status: true, createdById: true, ownerId: true, customer: { select: { name: true } } },
      },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    tripId: r.trip.id,
    reference: r.trip.reference,
    customer: r.trip.customer.name,
    country: r.trip.country,
    category: r.category,
    description: r.description,
    timeLabel: r.timeLabel,
    scheduledAt: r.scheduledAt!.toISOString(),
    placeName: r.placeName,
    crew: crewLine(r),
    flightNumber: r.category === 'flight' ? text(r.details, 'flightNumber') : null,
    completed: r.completedAt !== null,
    canEdit: canEditTrip(r.trip, user.id, isAdmin),
  }));
}

// --- Flights -----------------------------------------------------------------

async function loadFlights(user: AccessUser, isAdmin: boolean): Promise<OpsFlight[]> {
  const now = Date.now();
  const rows = await prisma.tripItineraryItem.findMany({
    where: {
      category: 'flight',
      scheduledAt: { gte: new Date(now - FLIGHTS_BEHIND_MS), lt: new Date(now + FLIGHTS_AHEAD_MS) },
      trip: liveTrips(user, isAdmin),
    },
    orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
    take: FLIGHT_LIMIT,
    select: {
      id: true,
      timeLabel: true,
      scheduledAt: true,
      endsAt: true,
      durationMinutes: true,
      providerName: true,
      details: true,
      completedAt: true,
      trip: {
        select: {
          id: true,
          reference: true,
          title: true,
          country: true,
          status: true,
          createdById: true,
          ownerId: true,
          customer: { select: { name: true } },
        },
      },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    tripId: r.trip.id,
    tripReference: r.trip.reference,
    tripTitle: r.trip.title,
    customer: r.trip.customer.name,
    country: r.trip.country,
    timeLabel: r.timeLabel,
    scheduledAt: r.scheduledAt?.toISOString() ?? null,
    endsAt: r.endsAt?.toISOString() ?? null,
    durationMinutes: r.durationMinutes,
    airline: r.providerName,
    flightNumber: text(r.details, 'flightNumber'),
    from: text(r.details, 'departAirport'),
    to: text(r.details, 'arriveAirport'),
    timezone: text(r.details, 'timezone'),
    completed: r.completedAt !== null,
    canEdit: canEditTrip(r.trip, user.id, isAdmin),
  }));
}

// --- WhatsApp ----------------------------------------------------------------

type PreviewRow = {
  accountId: number;
  chatId: string;
  text: string;
  fromMe: boolean;
  senderName: string;
  mediaKind: string | null;
};

/** The viewer's own WhatsApp accounts only, as in the WhatsApp module. */
async function loadWhatsapp(user: AccessUser): Promise<OpsWhatsapp> {
  const accounts = await listAccounts(user.id, 'whatsapp');
  if (accounts.length === 0) return { linked: false, unreadChats: 0, chats: [] };
  const accountIds = accounts.map((a) => a.id);

  const [chats, unreadChats] = await Promise.all([
    prisma.messagingChat.findMany({
      where: { accountId: { in: accountIds } },
      orderBy: { lastMessageAt: 'desc' },
      take: CHAT_LIMIT,
    }),
    prisma.messagingChat.count({ where: { accountId: { in: accountIds }, unreadCount: { gt: 0 } } }),
  ]);

  // Each chat's newest message in one round trip: an index lookup per chat
  // (accountId, chatId, at), rather than reading the chats' whole history.
  const previews =
    chats.length === 0
      ? []
      : await prisma.$queryRaw<PreviewRow[]>`
          SELECT c."accountId", c."chatId", m."text", m."fromMe", m."senderName", m."mediaKind"
          FROM unnest(${chats.map((c) => c.accountId)}::int[], ${chats.map((c) => c.chatId)}::text[]) AS c("accountId", "chatId")
          CROSS JOIN LATERAL (
            SELECT mm."text", mm."fromMe", mm."senderName", mm."mediaKind"
            FROM "MessagingMessage" mm
            WHERE mm."accountId" = c."accountId" AND mm."chatId" = c."chatId"
            ORDER BY mm."at" DESC
            LIMIT 1
          ) m`;
  const previewOf = new Map(previews.map((p) => [`${p.accountId}:${p.chatId}`, p]));

  return {
    linked: true,
    unreadChats,
    chats: chats.map((c) => {
      const m = previewOf.get(`${c.accountId}:${c.chatId}`);
      return {
        accountId: c.accountId,
        chatId: c.chatId,
        name: c.name || c.chatId,
        kind: c.kind === 'group' ? 'group' : 'dm',
        lastMessageAt: c.lastMessageAt.toISOString(),
        unread: c.unreadCount,
        preview: m ? { text: m.text.slice(0, 140), fromMe: m.fromMe, senderName: m.senderName, mediaKind: m.mediaKind } : null,
      };
    }),
  };
}

// --- Handover ----------------------------------------------------------------

const HANDOVER_URGENCY: Record<string, number> = { Urgent: 0, Attention: 1 };

/** The shift log's unacknowledged entries from the last week, as the Handover module keeps them. */
async function loadHandover(user: AccessUser): Promise<OpsHandover> {
  const where: Prisma.HandoverEntryWhereInput = {
    acknowledgedAt: null,
    shiftDate: { gte: new Date(Date.now() - HANDOVER_WINDOW_MS) },
  };
  const [rows, awaiting] = await Promise.all([
    prisma.handoverEntry.findMany({
      where,
      orderBy: [{ shiftDate: 'desc' }, { id: 'desc' }],
      take: 30,
      select: {
        id: true,
        shiftDate: true,
        shiftPeriod: true,
        post: true,
        status: true,
        summary: true,
        watchItems: true,
        createdAt: true,
        createdById: true,
        createdBy: { select: { name: true } },
      },
    }),
    prisma.handoverEntry.count({ where }),
  ]);
  const rank = (status: string) => HANDOVER_URGENCY[status] ?? 2;
  return {
    awaiting,
    items: rows
      .sort((a, b) => rank(a.status) - rank(b.status))
      .slice(0, HANDOVER_LIMIT)
      .map((h) => ({
        id: h.id,
        shiftDate: h.shiftDate.toISOString(),
        shiftPeriod: h.shiftPeriod,
        post: h.post,
        status: h.status,
        summary: h.summary,
        watchItems: h.watchItems,
        author: h.createdBy?.name ?? null,
        createdAt: h.createdAt.toISOString(),
        mine: h.createdById === user.id,
      })),
  };
}

// --- Tasks -------------------------------------------------------------------

async function loadTasks(user: AccessUser): Promise<OpsTasks> {
  const today = startOfToday();
  const where: Prisma.PersonalTodoWhereInput = {
    completed: false,
    deletedAt: null,
    OR: [{ userId: user.id }, { shares: { some: { userId: user.id } } }],
  };
  const [rows, open, overdue] = await Promise.all([
    prisma.personalTodo.findMany({
      where,
      orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: TASK_LIMIT,
      select: { id: true, userId: true, title: true, priority: true, status: true, dueDate: true },
    }),
    prisma.personalTodo.count({ where }),
    prisma.personalTodo.count({ where: { ...where, dueDate: { lt: today } } }),
  ]);
  return {
    open,
    overdue,
    tasks: rows.map((t) => ({
      id: t.id,
      title: t.title,
      priority: t.priority,
      status: t.status,
      dueDate: t.dueDate?.toISOString() ?? null,
      days: t.dueDate ? daysFrom(t.dueDate, today) : null,
      shared: t.userId !== user.id,
    })),
  };
}

// --- Fuel --------------------------------------------------------------------

async function loadFuel(today: string): Promise<OpsFuel> {
  // From the 1st, compared the way the Car Fuel page's "This month" is.
  const monthStart = dateKeyToDate(`${today.slice(0, 7)}-01`);
  const [month, recent] = await Promise.all([
    prisma.vehicleFuelLog.groupBy({
      by: ['currency'],
      where: { filledAt: { gte: monthStart } },
      _sum: { litres: true, cost: true },
      _count: { _all: true },
    }),
    prisma.vehicleFuelLog.findMany({
      orderBy: [{ filledAt: 'desc' }, { id: 'desc' }],
      take: FUEL_RECENT,
      select: {
        id: true,
        filledAt: true,
        litres: true,
        cost: true,
        currency: true,
        station: true,
        vehicle: { select: { registration: true } },
      },
    }),
  ]);

  const spend: Record<string, number> = {};
  for (const row of month) {
    const cost = row._sum.cost?.toNumber();
    if (cost) spend[row.currency] = cost;
  }
  return {
    month: {
      fills: month.reduce((n, row) => n + row._count._all, 0),
      litres: Math.round(month.reduce((n, row) => n + (row._sum.litres?.toNumber() ?? 0), 0) * 100) / 100,
      spend,
    },
    recent: recent.map((r) => ({
      id: r.id,
      vehicle: r.vehicle.registration,
      filledAt: r.filledAt.toISOString(),
      litres: r.litres.toNumber(),
      cost: r.cost?.toNumber() ?? null,
      currency: r.currency,
      station: r.station,
    })),
  };
}

// --- Maintenance -------------------------------------------------------------

const JOB_URGENCY: Record<MaintenanceDisplayStatus, number> = {
  Overdue: 0,
  'In progress': 1,
  'Due soon': 2,
  Planned: 3,
  Completed: 4,
  Cancelled: 4,
};

/** Open work by urgency, and the next services falling due. Pure, for the tests. */
export function summarizeMaintenance(
  items: MaintenanceDto[],
  odometers: Record<number, number>,
  today: string,
): OpsMaintenance {
  const open = items
    .filter(isOpenMaintenance)
    .map((item) => ({ item, display: maintenanceDisplayStatus(item, today) }))
    .sort(
      (a, b) =>
        JOB_URGENCY[a.display] - JOB_URGENCY[b.display] ||
        (a.item.scheduledFor ?? '9999').localeCompare(b.item.scheduledFor ?? '9999') ||
        a.item.id - b.item.id,
    );
  const tally = (display: MaintenanceDisplayStatus) => open.filter((o) => o.display === display).length;

  // Planned work is already a row above; these are the next-due dates and km.
  const comingDue = activeMaintenanceReminders(
    items.filter((item) => item.status !== 'Cancelled'),
    odometers,
    today,
  )
    .filter((r) => r.basis !== 'planned')
    .slice(0, COMING_DUE_LIMIT)
    .map((r) => ({ key: r.key, maintenanceId: r.item.id, message: reminderMessage(r), overdue: r.stage === 'overdue' }));

  return {
    overdue: tally('Overdue'),
    dueSoon: tally('Due soon'),
    inProgress: tally('In progress'),
    jobs: open.slice(0, JOB_LIMIT).map(({ item, display }) => ({
      id: item.id,
      vehicle: item.vehicle.registration,
      kind: item.kind,
      category: item.category,
      title: item.title,
      status: item.status,
      display,
      scheduledFor: item.scheduledFor,
    })),
    comingDue,
  };
}

async function loadMaintenance(today: string): Promise<OpsMaintenance> {
  const [items, odometers] = await Promise.all([listMaintenance(), listVehicleOdometers()]);
  return summarizeMaintenance(items, odometers, today);
}

// --- Trackers, map, vehicles -------------------------------------------------

async function loadTrackers(devices: () => Promise<TrackedDevices>): Promise<OpsTrackers> {
  const { devices: list, sources } = await devices();
  const failed = Object.entries(sources)
    .filter(([, status]) => status.configured && status.error)
    .map(([name, status]) => `${name}: ${status.error}`);
  return {
    configured: Object.values(sources).some((status) => status.configured),
    error: failed.length > 0 ? failed.join(' · ') : null,
    devices: list,
  };
}

async function loadMap(devices: () => Promise<TrackedDevices>): Promise<OpsMap> {
  const [trackers, workspace] = await Promise.all([loadTrackers(devices), getMapWorkspace()]);
  return {
    ...trackers,
    categories: workspace.categories,
    geofences: workspace.geofences.filter((fence) => fence.visible),
    deviceTags: workspace.deviceTags,
  };
}

async function loadVehicles(): Promise<OpsVehicles> {
  const rows = await prisma.vehicle.groupBy({ by: ['status'], _count: { _all: true } });
  const byStatus = rows.map((row) => ({ status: row.status, count: row._count._all })).sort((a, b) => b.count - a.count);
  return { total: byStatus.reduce((sum, row) => sum + row.count, 0), byStatus };
}

// --- The board ---------------------------------------------------------------

const EMPTY: OpsSections = {
  map: { configured: false, error: null, devices: [], categories: [], geofences: [], deviceTags: [] },
  trackers: { configured: false, error: null, devices: [] },
  vehicles: { total: 0, byStatus: [] },
  movements: [],
  trips: { active: 0, startingSoon: 0, trips: [], escalations: [] },
  flights: [],
  whatsapp: { linked: false, unreadChats: 0, chats: [] },
  handover: { awaiting: 0, items: [] },
  tasks: { open: 0, overdue: 0, tasks: [] },
  maintenance: { overdue: 0, dueSoon: 0, inProgress: 0, jobs: [], comingDue: [] },
  fuel: { month: { fills: 0, litres: 0, spend: {} }, recent: [] },
};

/** The panels this viewer holds modules for, in board order. */
export function allowedPanels(user: AccessUser): OpsPanelKey[] {
  const isAdmin = userHasRole(user, ADMIN_ROLE_NAME);
  return OPS_PANELS.filter((key) => isAdmin || userHasModule(user, PANEL_MODULE[key]));
}

/** The board, or just the `panels` asked for (any the viewer may not see are left out). */
export async function loadOpsDashboard(user: AccessUser, panels?: readonly OpsPanelKey[] | null): Promise<OpsDashboard> {
  const isAdmin = userHasRole(user, ADMIN_ROLE_NAME);
  const allowed = allowedPanels(user);
  const wanted = panels ? allowed.filter((key) => panels.includes(key)) : allowed;
  // The server's TZ is the business's (see .env.example).
  const today = localDateKey();

  // The map and the trackers panel read the same positions: one call serves both.
  let tracked: Promise<TrackedDevices> | null = null;
  const devices = () => (tracked ??= listTrackedDevices());

  const loaders: { [K in OpsPanelKey]: () => Promise<OpsSections[K]> } = {
    map: () => loadMap(devices),
    trackers: () => loadTrackers(devices),
    vehicles: () => loadVehicles(),
    movements: () => loadMovements(user, isAdmin),
    trips: () => loadTrips(user, isAdmin),
    flights: () => loadFlights(user, isAdmin),
    whatsapp: () => loadWhatsapp(user),
    handover: () => loadHandover(user),
    tasks: () => loadTasks(user),
    maintenance: () => loadMaintenance(today),
    fuel: () => loadFuel(today),
  };
  const loaded = await Promise.all(
    wanted.map(async (key) => [key, await safe<OpsSections[typeof key]>(key, loaders[key], EMPTY[key])] as const),
  );

  return {
    generatedAt: new Date().toISOString(),
    allowed,
    sections: Object.fromEntries(loaded) as Partial<OpsSections>,
    canOpenFlightTracker: isAdmin || userHasModule(user, 'flight-tracker'),
  };
}

/** The vehicles and currency the fuel and maintenance forms need, when the viewer has either. */
export async function loadOpsReference(user: AccessUser): Promise<OpsReference | null> {
  const allowed = allowedPanels(user);
  if (!allowed.includes('fuel') && !allowed.includes('maintenance')) return null;
  const [vehicles, organization] = await Promise.all([listFleetVehicles(), getOrganizationSettings()]);
  return { vehicles, defaultCurrency: organization.defaultCurrency };
}
