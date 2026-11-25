import 'server-only';

import { API_ACCESS } from '@/lib/api-access';
import { type LicenseStatus, listDriverLicenses } from '@/lib/drivers';
import {
  MAINTENANCE_CATEGORIES,
  MAINTENANCE_STATUSES,
  fuelEconomyByLog,
  isOpenMaintenance,
  maintenanceDisplayStatus,
  totalsByCurrency,
} from '@/lib/fleet';
import { listFleetVehicles, listFuelLogs, listMaintenance, listVehicleOdometers } from '@/lib/fleet-server';
import { FUEL_CURRENCY, buildStatement, entityLabel, isLowBalance } from '@/lib/fuel-cards';
import { getFuelCardStatement, listFuelCards } from '@/lib/fuel-cards-server';
import { isParkingLow, parkingStatement } from '@/lib/parking-cards';
import { getParkingStatement, listParkingCards } from '@/lib/parking-cards-server';
import { userHasModule } from '@/lib/user';
import { utcToZoned } from '@/lib/zoned-time';

import { asString, type ToolContext, type ToolDefinition, ToolRefusal } from '../types';
import { localStamp, matches, optDate, optEnum, optFlag, optId, pageOf, reqId, todayIn } from './_shared';

/**
 * The Fleet modules beside the vehicle register, read only: Car Maintenance,
 * Car Fuel, Fuel Cards, Parking Cards and Drivers License Expiry. Each is its
 * own grant, so each tool carries its own module's gate.
 */
const PAGE_SIZE = 20;

const clip = (text: string | null, max: number) => (text && text.length > max ? `${text.slice(0, max)}…` : text);
const round2 = (n: number) => Math.round(n * 100) / 100;
/** The calendar day an instant falls on for the user. */
const localDay = (iso: string, ctx: ToolContext) => utcToZoned(iso, ctx.timeZone).date;
/** A card number as its last four digits: enough to tell cards apart without handing the number on. */
const lastFour = (cardNumber: string | null) => (cardNumber ? `…${cardNumber.replace(/\s+/g, '').slice(-4)}` : null);

function dateRange(args: Record<string, unknown>): { from: string | undefined; to: string | undefined } {
  const from = optDate(args, 'from') ?? undefined;
  const to = optDate(args, 'to') ?? undefined;
  if (from && to && to < from) throw new ToolRefusal('to is before from.');
  return { from, to };
}

const inRange = (day: string | null, from: string | undefined, to: string | undefined) =>
  (!from && !to) || (day !== null && (!from || day >= from) && (!to || day <= to));

// --- Car Maintenance ---------------------------------------------------------------

const MAINTENANCE_FILTERS = [...MAINTENANCE_STATUSES, 'Open', 'Overdue', 'Due soon'] as const;

const listMaintenanceTool: ToolDefinition = {
  destructive: false,
  kind: 'read',
  requiredModule: API_ACCESS.fleetMaintenance,
  functionDeclaration: {
    name: 'list_vehicle_maintenance',
    description:
      "Maintenance jobs on our own vehicles, as Car Maintenance lists them: vehicle, work, status (Overdue and Due soon worked out from the planned date), dates, cost, garage and next due. Filter by vehicle, status, category or dates. 20 per page.",
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Number plate, make, work, garage or notes' },
        vehicleId: { type: 'integer' },
        status: { type: 'string', enum: [...MAINTENANCE_FILTERS], description: 'Open = Planned or In progress' },
        category: { type: 'string', enum: [...MAINTENANCE_CATEGORIES] },
        from: { type: 'string', description: 'YYYY-MM-DD: done or planned on or after' },
        to: { type: 'string', description: 'YYYY-MM-DD: done or planned on or before' },
        page: { type: 'integer' },
      },
    },
  },
  async handler(args, ctx) {
    const q = asString(args.q);
    const vehicleId = optId(args, 'vehicleId');
    const status = optEnum(args, 'status', MAINTENANCE_FILTERS);
    const category = optEnum(args, 'category', MAINTENANCE_CATEGORIES);
    const { from, to } = dateRange(args);
    const today = todayIn(ctx.timeZone);

    // Our own fleet only, as the Car Maintenance page loads it.
    const items = await listMaintenance({ internalOnly: true });
    const wanted = items
      .map((item) => ({ item, display: maintenanceDisplayStatus(item, today) }))
      .filter(({ item, display }) => {
        if (vehicleId && item.vehicle.id !== vehicleId) return false;
        if (category && item.category !== category) return false;
        if (status === 'Open' ? !isOpenMaintenance(item) : status === 'Overdue' || status === 'Due soon' ? display !== status : status && item.status !== status) {
          return false;
        }
        if (!inRange(item.completedAt ?? item.scheduledFor, from, to)) return false;
        return matches(q, item.vehicle.registration, item.vehicle.make, item.vehicle.model, item.title, item.category, item.provider, item.notes);
      });
    const { rows, page, total, more } = pageOf(wanted, args, PAGE_SIZE);
    const count = (name: string) => wanted.filter((row) => row.display === name).length;
    return {
      total,
      page,
      more,
      overdue: count('Overdue'),
      dueSoon: count('Due soon'),
      inProgress: count('In progress'),
      costByCurrency: totalsByCurrency(wanted.map((row) => row.item)),
      jobs: rows.map(({ item, display }) => ({
        id: item.id,
        vehicleId: item.vehicle.id,
        vehicle: item.vehicle.registration,
        work: item.title,
        category: item.category,
        kind: item.kind,
        status: display,
        plannedFor: item.scheduledFor,
        completed: item.completedAt,
        ...(item.cost != null ? { cost: item.cost, currency: item.currency } : {}),
        ...(item.provider ? { garage: item.provider } : {}),
        ...(item.odometerKm != null ? { odometerKm: item.odometerKm } : {}),
        ...(item.nextDueAt ? { nextDue: item.nextDueAt } : {}),
        ...(item.nextDueKm != null ? { nextDueKm: item.nextDueKm } : {}),
        ...(item.notes ? { notes: clip(item.notes, 160) } : {}),
      })),
      today,
      href: '/modules/car-maintenance',
    };
  },
};

const listOdometersTool: ToolDefinition = {
  destructive: false,
  kind: 'read',
  // The readings combine fill-ups, maintenance and trip logs: only Car Maintenance shows them.
  requiredModule: API_ACCESS.fleetMaintenance,
  functionDeclaration: {
    name: 'list_vehicle_odometers',
    description:
      "Each of our own vehicles' highest odometer reading on file (from fill-ups, maintenance and trip logs), highest first. 20 per page.",
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Number plate, make or model' },
        page: { type: 'integer' },
      },
    },
  },
  async handler(args) {
    const q = asString(args.q);
    const [vehicles, odometers] = await Promise.all([listFleetVehicles({ internalOnly: true }), listVehicleOdometers()]);
    const wanted = vehicles
      .filter((vehicle) => matches(q, vehicle.registration, vehicle.make, vehicle.model))
      .map((vehicle) => ({ vehicle, km: odometers[vehicle.id] ?? null }))
      .sort((a, b) => (b.km ?? -1) - (a.km ?? -1) || a.vehicle.registration.localeCompare(b.vehicle.registration));
    const { rows, page, total, more } = pageOf(wanted, args, PAGE_SIZE);
    return {
      total,
      page,
      more,
      withoutReading: wanted.filter((row) => row.km === null).length,
      vehicles: rows.map(({ vehicle, km }) => ({
        vehicleId: vehicle.id,
        vehicle: vehicle.registration,
        model: [vehicle.make, vehicle.model].filter(Boolean).join(' ') || null,
        odometerKm: km,
      })),
      href: '/modules/car-maintenance',
    };
  },
};

export const maintenanceTools: ToolDefinition[] = [listMaintenanceTool, listOdometersTool];

// --- Car Fuel ----------------------------------------------------------------------

const listFuelTool: ToolDefinition = {
  destructive: false,
  kind: 'read',
  requiredModule: API_ACCESS.fleetFuel,
  functionDeclaration: {
    name: 'list_fuel_logs',
    description:
      'Fill-ups from Car Fuel, newest first: vehicle, when, litres, cost, odometer, station, who filled, the fuel card that paid, and km per litre where it can be worked out. Totals cover everything that matches. Filter by vehicle or dates. 20 per page.',
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Number plate, make, station, who filled or card name' },
        vehicleId: { type: 'integer' },
        from: { type: 'string', description: 'YYYY-MM-DD' },
        to: { type: 'string', description: 'YYYY-MM-DD' },
        page: { type: 'integer' },
      },
    },
  },
  async handler(args, ctx) {
    const q = asString(args.q);
    const vehicleId = optId(args, 'vehicleId');
    const { from, to } = dateRange(args);
    const logs = await listFuelLogs();
    // Consumption needs the fill-ups either side, so it is worked out before filtering.
    const economy = fuelEconomyByLog(logs);
    const wanted = logs.filter(
      (log) =>
        (!vehicleId || log.vehicle.id === vehicleId) &&
        inRange(localDay(log.filledAt, ctx), from, to) &&
        matches(q, log.vehicle.registration, log.vehicle.make, log.vehicle.model, log.station, log.filledBy, log.fuelCard?.name, log.notes),
    );
    const { rows, page, total, more } = pageOf(wanted, args, PAGE_SIZE);
    return {
      total,
      page,
      more,
      litres: round2(wanted.reduce((sum, log) => sum + log.litres, 0)),
      spendByCurrency: totalsByCurrency(wanted),
      fillUps: rows.map((log) => ({
        id: log.id,
        vehicleId: log.vehicle.id,
        vehicle: log.vehicle.registration,
        when: localStamp(log.filledAt, ctx.timeZone),
        litres: log.litres,
        ...(log.cost != null ? { cost: log.cost, currency: log.currency } : {}),
        ...(log.odometerKm != null ? { odometerKm: log.odometerKm } : {}),
        fuel: log.fuelType,
        fullTank: log.fullTank,
        ...(log.station ? { station: log.station } : {}),
        ...(log.filledBy ? { filledBy: log.filledBy } : {}),
        ...(log.fuelCard ? { paidWith: log.fuelCard.name } : {}),
        ...(economy.has(log.id) ? { kmPerLitre: economy.get(log.id)!.kmPerLitre } : {}),
      })),
      timesShownIn: ctx.timeZone,
      href: '/modules/car-fuel',
    };
  },
};

export const fuelTools: ToolDefinition[] = [listFuelTool];

// --- Fuel Cards and Parking Cards --------------------------------------------------

/** Parking and toll cards are loaded and spent in Kenyan shillings (lib/parking-cards.ts). */
const PARKING_CURRENCY = 'KES';

const fuelCardHref = (id: number) => `/modules/fuel-cards?card=${id}`;
const parkingCardHref = (id: number) => `/modules/parking-cards?card=${id}`;

const listFuelCardsTool: ToolDefinition = {
  destructive: false,
  kind: 'read',
  requiredModule: API_ACCESS.fuelCards,
  functionDeclaration: {
    name: 'list_fuel_cards',
    description:
      'Prepaid fuel cards with their balance in KES, alert level, the vehicle each is issued to, and whether it is low. Active cards first. 20 per page.',
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Card name, provider, company or number plate' },
        lowOnly: { type: 'boolean', description: 'Only active cards below their alert level' },
        page: { type: 'integer' },
      },
    },
  },
  async handler(args) {
    const q = asString(args.q);
    const lowOnly = optFlag(args, 'lowOnly') ?? false;
    const cards = await listFuelCards();
    const isLow = (card: (typeof cards)[number]) => card.active && isLowBalance(card.balance, card.lowBalanceThreshold);
    const wanted = cards.filter(
      (card) => (!lowOnly || isLow(card)) && matches(q, card.name, card.provider, entityLabel(card.entity), card.entity, card.vehicle?.registration),
    );
    const { rows, page, total, more } = pageOf(wanted, args, PAGE_SIZE);
    return {
      total,
      page,
      more,
      currency: FUEL_CURRENCY,
      low: cards.filter(isLow).length,
      totalBalance: round2(wanted.filter((card) => card.active).reduce((sum, card) => sum + card.balance, 0)),
      cards: rows.map((card) => ({
        id: card.id,
        name: card.name,
        provider: card.provider,
        company: entityLabel(card.entity),
        vehicle: card.vehicle?.registration ?? 'spare',
        balance: card.balance,
        alertBelow: card.lowBalanceThreshold,
        ...(isLow(card) ? { low: true } : {}),
        ...(card.active ? {} : { active: false }),
        fillUps: card.fills,
        cardNumber: lastFour(card.cardNumber),
        href: fuelCardHref(card.id),
      })),
    };
  },
};

const fuelCardStatementTool: ToolDefinition = {
  destructive: false,
  kind: 'read',
  requiredModule: API_ACCESS.fuelCards,
  functionDeclaration: {
    name: 'get_fuel_card_statement',
    description:
      "One fuel card's statement, newest first: top-ups, adjustments and the fill-ups it paid, each with the balance after it. Filter by dates. 20 entries per page.",
    parameters: {
      type: 'object',
      properties: {
        cardId: { type: 'integer' },
        from: { type: 'string', description: 'YYYY-MM-DD' },
        to: { type: 'string', description: 'YYYY-MM-DD' },
        page: { type: 'integer' },
      },
      required: ['cardId'],
    },
  },
  async handler(args, ctx) {
    const id = reqId(args, 'cardId', 'use list_fuel_cards');
    const { from, to } = dateRange(args);
    const statement = await getFuelCardStatement(id);
    if (!statement) throw new ToolRefusal(`Fuel card ${id} was not found. Find it with list_fuel_cards.`);
    const { card } = statement;
    // Balances are run over the whole history first, so a date window still shows true balances.
    const entries = buildStatement(statement.topUps, statement.fills).filter((entry) => inRange(localDay(entry.at, ctx), from, to));
    const { rows, page, total, more } = pageOf(entries, args, PAGE_SIZE);
    return {
      card: {
        id: card.id,
        name: card.name,
        provider: card.provider,
        company: entityLabel(card.entity),
        vehicle: card.vehicle?.registration ?? 'spare',
        balance: card.balance,
        alertBelow: card.lowBalanceThreshold,
        low: card.active && isLowBalance(card.balance, card.lowBalanceThreshold),
        active: card.active,
        loaded: card.loaded,
        spent: card.spent,
        cardNumber: lastFour(card.cardNumber),
        ...(card.notes ? { notes: clip(card.notes, 200) } : {}),
      },
      currency: FUEL_CURRENCY,
      total,
      page,
      more,
      moneyIn: round2(entries.filter((entry) => entry.amount > 0).reduce((sum, entry) => sum + entry.amount, 0)),
      moneyOut: round2(-entries.filter((entry) => entry.amount < 0).reduce((sum, entry) => sum + entry.amount, 0)),
      entries: rows.map((entry) => ({
        when: localStamp(entry.at, ctx.timeZone),
        kind: entry.kind,
        amount: entry.amount,
        balanceAfter: entry.balanceAfter,
        what: entry.title,
        ...(entry.detail ? { detail: clip(entry.detail, 120) } : {}),
      })),
      timesShownIn: ctx.timeZone,
      href: fuelCardHref(card.id),
    };
  },
};

const listParkingCardsTool: ToolDefinition = {
  destructive: false,
  kind: 'read',
  requiredModule: API_ACCESS.parkingCards,
  functionDeclaration: {
    name: 'list_parking_cards',
    description:
      'Parking and toll cards (KAPS, PAYTECH, PARK n GO, Express Way) with their balance in KES, alert level, vehicle, when last used and whether low. 20 per page.',
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Card name, provider or number plate' },
        lowOnly: { type: 'boolean', description: 'Only active cards below their alert level' },
        page: { type: 'integer' },
      },
    },
  },
  async handler(args, ctx) {
    const q = asString(args.q);
    const lowOnly = optFlag(args, 'lowOnly') ?? false;
    const cards = await listParkingCards();
    const wanted = cards.filter((card) => (!lowOnly || isParkingLow(card)) && matches(q, card.name, card.provider, card.vehicle?.registration));
    const { rows, page, total, more } = pageOf(wanted, args, PAGE_SIZE);
    return {
      total,
      page,
      more,
      currency: PARKING_CURRENCY,
      low: cards.filter(isParkingLow).length,
      cards: rows.map((card) => ({
        id: card.id,
        name: card.name,
        provider: card.provider,
        vehicle: card.vehicle?.registration ?? null,
        balance: card.balance,
        alertBelow: card.lowBalanceThreshold,
        ...(isParkingLow(card) ? { low: true } : {}),
        ...(card.active ? {} : { active: false }),
        lastUsed: localStamp(card.lastEntryAt, ctx.timeZone),
        entries: card.entries,
        cardNumber: lastFour(card.cardNumber),
        href: parkingCardHref(card.id),
      })),
    };
  },
};

const parkingStatementTool: ToolDefinition = {
  destructive: false,
  kind: 'read',
  requiredModule: API_ACCESS.parkingCards,
  functionDeclaration: {
    name: 'get_parking_card_statement',
    description:
      "One parking card's statement, newest first: parking paid, top-ups and balance checks, each with the balance after it. Filter by dates. 20 entries per page.",
    parameters: {
      type: 'object',
      properties: {
        cardId: { type: 'integer' },
        from: { type: 'string', description: 'YYYY-MM-DD' },
        to: { type: 'string', description: 'YYYY-MM-DD' },
        page: { type: 'integer' },
      },
      required: ['cardId'],
    },
  },
  async handler(args, ctx) {
    const id = reqId(args, 'cardId', 'use list_parking_cards');
    const { from, to } = dateRange(args);
    const statement = await getParkingStatement(id);
    if (!statement) throw new ToolRefusal(`Parking card ${id} was not found. Find it with list_parking_cards.`);
    const { card } = statement;
    const entries = parkingStatement(statement.entries).filter((entry) => inRange(localDay(entry.occurredAt, ctx), from, to));
    const { rows, page, total, more } = pageOf(entries, args, PAGE_SIZE);
    return {
      card: {
        id: card.id,
        name: card.name,
        provider: card.provider,
        vehicle: card.vehicle?.registration ?? null,
        balance: card.balance,
        alertBelow: card.lowBalanceThreshold,
        low: isParkingLow(card),
        active: card.active,
        cardNumber: lastFour(card.cardNumber),
        ...(card.notes ? { notes: clip(card.notes, 200) } : {}),
      },
      currency: PARKING_CURRENCY,
      total,
      page,
      more,
      toppedUp: round2(entries.filter((entry) => entry.amount > 0).reduce((sum, entry) => sum + entry.amount, 0)),
      spent: round2(-entries.filter((entry) => entry.amount < 0).reduce((sum, entry) => sum + entry.amount, 0)),
      entries: rows.map((entry) => ({
        when: localStamp(entry.occurredAt, ctx.timeZone),
        kind: entry.kind,
        amount: entry.amount,
        balanceAfter: entry.balanceAfter,
        ...(entry.observedBalance != null ? { cardShowed: entry.observedBalance } : {}),
        ...(entry.vehicle ? { vehicle: entry.vehicle.registration } : {}),
        ...(entry.location ? { where: entry.location } : {}),
        ...(entry.reference ? { reference: entry.reference } : {}),
        ...(entry.createdBy ? { loggedBy: entry.createdBy.name } : {}),
      })),
      timesShownIn: ctx.timeZone,
      href: parkingCardHref(card.id),
    };
  },
};

export const cardTools: ToolDefinition[] = [listFuelCardsTool, fuelCardStatementTool, listParkingCardsTool, parkingStatementTool];

// --- Driver licences ---------------------------------------------------------------

const LICENCE_STATUSES = ['Valid', 'Expiring Soon', 'Expired'] as const satisfies readonly LicenseStatus[];

const listLicencesTool: ToolDefinition = {
  destructive: false,
  kind: 'read',
  requiredModule: API_ACCESS.licences,
  functionDeclaration: {
    name: 'list_driver_licences',
    description:
      "Drivers' licences, soonest expiry first: driver, licence number, class, expiry, days left and status (Expiring Soon = within 30 days). Filter by status or driver. 20 per page.",
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Driver name or licence number' },
        status: { type: 'string', enum: [...LICENCE_STATUSES] },
        page: { type: 'integer' },
      },
    },
  },
  async handler(args, ctx) {
    const q = asString(args.q);
    const status = optEnum(args, 'status', LICENCE_STATUSES);
    const licences = await listDriverLicenses();
    const wanted = licences.filter((licence) => (!status || licence.status === status) && matches(q, licence.driverName, licence.licenseNumber));
    const { rows, page, total, more } = pageOf(wanted, args, PAGE_SIZE);
    // A driver's profile where the user can open it, else the licence register: as search links them.
    const canOpenDrivers = ctx.isAdmin || userHasModule(ctx.user, 'drivers');
    return {
      total,
      page,
      more,
      expired: licences.filter((licence) => licence.status === 'Expired').length,
      expiringSoon: licences.filter((licence) => licence.status === 'Expiring Soon').length,
      licences: rows.map((licence) => ({
        id: licence.id,
        driver: licence.driverName,
        licenceNumber: licence.licenseNumber,
        class: licence.category,
        // A date-only value, saved at midnight UTC.
        expires: licence.expiryDate.slice(0, 10),
        daysLeft: licence.daysRemaining,
        status: licence.status,
        lastVerified: licence.lastVerified ? licence.lastVerified.slice(0, 10) : null,
        ...(licence.notes ? { notes: clip(licence.notes, 120) } : {}),
        href: licence.personnelId && canOpenDrivers ? `/modules/drivers?person=${licence.personnelId}` : '/modules/drivers-license-expiry',
      })),
    };
  },
};

export const licenceTools: ToolDefinition[] = [listLicencesTool];
