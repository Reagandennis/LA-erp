import 'server-only';

import { PrismaClient } from '@prisma/client';

declare global {
  var prismaGlobal2: PrismaClient | undefined;
}

export const prisma =
  globalThis.prismaGlobal2 ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.prismaGlobal2 = prisma;
}
