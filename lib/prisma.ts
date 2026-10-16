import 'server-only';

import { PrismaClient } from '@prisma/client';

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
      candidate.aiSettings,
  );
}

const cachedClient = globalThis.prismaGlobal;

export const prisma =
  cachedClient && hasRequiredDelegates(cachedClient)
    ? cachedClient
    : createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.prismaGlobal = prisma;
}
