import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireRequestAuth } from '@/lib/request-auth';
import {
  MAX_WORLD_CLOCKS,
  findWorldClockZone,
  resolveWorldClockZones,
} from '@/lib/world-clocks';

const selectionSchema = z.object({
  zones: z
    .array(z.string().trim().min(1))
    .max(MAX_WORLD_CLOCKS, `Pick at most ${MAX_WORLD_CLOCKS} clocks`),
});

export async function GET(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);

  if (response || !auth) {
    return response;
  }

  const record = await prisma.user.findUnique({
    where: { id: auth.user.id },
    select: { worldClockZones: true },
  });

  return NextResponse.json({
    zones: resolveWorldClockZones(record?.worldClockZones ?? []),
    max: MAX_WORLD_CLOCKS,
  });
}

export async function PUT(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);

  if (response || !auth) {
    return response;
  }

  const body = await request.json().catch(() => null);
  const validation = selectionSchema.safeParse(body);

  if (!validation.success) {
    return NextResponse.json(
      { error: validation.error.issues[0]?.message ?? 'Invalid selection' },
      { status: 400 },
    );
  }

  // Drop anything not in the catalogue so a hand-crafted payload can't push an
  // arbitrary string into `Intl.DateTimeFormat` on every other page load.
  const zones = [...new Set(validation.data.zones)].filter((tz) =>
    Boolean(findWorldClockZone(tz)),
  );

  await prisma.user.update({
    where: { id: auth.user.id },
    data: { worldClockZones: zones },
  });

  return NextResponse.json({ zones: resolveWorldClockZones(zones) });
}
