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
  };
  return Boolean(
    candidate.quote &&
      candidate.quoteItem &&
      candidate.quoteNotification &&
      candidate.quoteSequence &&
      candidate.customer &&
      candidate.product &&
      candidate.quoteTemplate &&
      candidate.organizationSettings,
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
