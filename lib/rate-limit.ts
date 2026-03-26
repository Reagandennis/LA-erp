import { prisma } from './prisma';

interface RateLimitOptions {
  scope: string;
  key: string;
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export async function enforceRateLimit(
  options: RateLimitOptions,
): Promise<RateLimitResult> {
  const now = Date.now();
  const bucketStart = new Date(Math.floor(now / options.windowMs) * options.windowMs);
  const bucketEnd = new Date(bucketStart.getTime() + options.windowMs);

  const bucket = await prisma.rateLimitBucket.upsert({
    where: {
      scope_key_windowStart: {
        scope: options.scope,
        key: options.key,
        windowStart: bucketStart,
      },
    },
    update: {
      count: {
        increment: 1,
      },
      expiresAt: bucketEnd,
    },
    create: {
      scope: options.scope,
      key: options.key,
      windowStart: bucketStart,
      expiresAt: bucketEnd,
      count: 1,
    },
  });

  return {
    allowed: bucket.count <= options.limit,
    remaining: Math.max(options.limit - bucket.count, 0),
    retryAfterSeconds: Math.max(
      Math.ceil((bucketEnd.getTime() - now) / 1000),
      0,
    ),
  };
}
