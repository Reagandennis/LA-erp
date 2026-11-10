import 'server-only';

import { PrismaClient } from '@prisma/client';

import { announceWrite, isWriteOperation, tableOfRawWrite } from './live-events';

declare global {
  var prismaGlobal: PrismaClient | undefined;
}

function createPrismaClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

function hasRequiredDelegates(client: PrismaClient): boolean {
  const candidate = client as unknown as {
    quote?: unknown;
    quoteItem?: unknown;
    quoteNotification?: unknown;
    quoteSequence?: unknown;
    customer?: unknown;
    product?: unknown;
    quoteTemplate?: unknown;
    organizationSettings?: unknown;
    trip?: unknown;
    tripItineraryItem?: unknown;
    tripSequence?: unknown;
    trackingSequence?: unknown;
    vehicle?: unknown;
    driver?: unknown;
    officer?: unknown;
    tripAssignment?: unknown;
    personnel?: unknown;
    driverLicense?: unknown;
    traveler?: unknown;
    tripTraveler?: unknown;
    exchangeRateSnapshot?: unknown;
    roleModule?: unknown;
    backupSettings?: unknown;
    backupRun?: unknown;
    aiUsage?: unknown;
    aiSettings?: unknown;
    tripItemAttachment?: unknown;
    tripItemTraveler?: unknown;
    tripCloseout?: unknown;
    tripShareLink?: unknown;
    vehicleFuelLog?: unknown;
    vehicleMaintenance?: unknown;
    vehicleMaintenanceNotification?: unknown;
  };
  return Boolean(
    candidate.quote &&
      candidate.quoteItem &&
      candidate.quoteNotification &&
      candidate.quoteSequence &&
      candidate.customer &&
      candidate.product &&
      candidate.quoteTemplate &&
      candidate.organizationSettings &&
      candidate.trip &&
      candidate.tripItineraryItem &&
      candidate.tripSequence &&
      candidate.trackingSequence &&
      candidate.vehicle &&
      candidate.driver &&
      candidate.officer &&
      candidate.tripAssignment &&
      candidate.personnel &&
      candidate.driverLicense &&
      candidate.traveler &&
      candidate.tripTraveler &&
      candidate.exchangeRateSnapshot &&
      candidate.roleModule &&
      candidate.backupSettings &&
      candidate.backupRun &&
      candidate.aiUsage &&
      candidate.aiSettings &&
      candidate.tripItemAttachment &&
      candidate.tripItemTraveler &&
      candidate.tripCloseout &&
      candidate.tripShareLink &&
      candidate.vehicleFuelLog &&
      candidate.vehicleMaintenance &&
      candidate.vehicleMaintenanceNotification,
  );
}

const cachedClient = globalThis.prismaGlobal;

const baseClient =
  cachedClient && hasRequiredDelegates(cachedClient)
    ? cachedClient
    : createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.prismaGlobal = baseClient;
}

/**
 * The one database client. Every write made through it, by any module or
 * background job, is reported to lib/live-events.ts, which tells open pages
 * to refresh. That single hook is what keeps the whole app in sync without
 * each route having to remember to announce its changes.
 *
 * `$extends` wraps the same client and the same connection pool; it opens
 * nothing new, so re-evaluating this module in development stays cheap.
 */
export const prisma = baseClient.$extends({
  query: {
    async $allOperations({ model, operation, args, query }) {
      const result = await query(args);
      if (model) {
        if (isWriteOperation(operation)) announceWrite(model, result);
      } else if (operation === '$executeRaw' || operation === '$executeRawUnsafe') {
        if (result !== 0) announceWrite(tableOfRawWrite(args));
      }
      return result;
    },
  },
}) as unknown as PrismaClient;
