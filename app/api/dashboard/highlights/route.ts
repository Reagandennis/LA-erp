import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import {
  HIGHLIGHT_SLOT_COUNT,
  listAvailableHighlights,
  loadHighlightValues,
  resolveHighlightKeys,
} from '@/lib/dashboard-highlights';
import { prisma } from '@/lib/prisma';
import { requireRequestAuth } from '@/lib/request-auth';

const selectionSchema = z.object({
  keys: z
    .array(z.string().trim().min(1))
    .max(HIGHLIGHT_SLOT_COUNT, `Pick at most ${HIGHLIGHT_SLOT_COUNT} highlights`),
});

export async function GET(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);

  if (response || !auth) {
    return response;
  }

  const record = await prisma.user.findUnique({
    where: { id: auth.user.id },
    select: { dashboardHighlights: true },
  });

  const selected = resolveHighlightKeys(auth.user, record?.dashboardHighlights ?? []);

  return NextResponse.json({
    available: listAvailableHighlights(auth.user),
    selected,
    slots: HIGHLIGHT_SLOT_COUNT,
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

  // Only persist keys this user is actually allowed to see, so a stale or
  // hand-crafted payload can never pin a metric from a module they lost access to.
  const allowed = new Set(
    listAvailableHighlights(auth.user).map((highlight) => highlight.key),
  );
  const keys = [...new Set(validation.data.keys)].filter((key) => allowed.has(key));

  await prisma.user.update({
    where: { id: auth.user.id },
    data: { dashboardHighlights: keys },
  });

  const selected = resolveHighlightKeys(auth.user, keys);

  return NextResponse.json({
    selected,
    highlights: await loadHighlightValues(auth.user, selected),
  });
}
