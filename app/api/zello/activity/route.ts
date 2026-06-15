import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireRequestAuth } from '@/lib/request-auth';
import { userHasModule, userHasRole } from '@/lib/user';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

const KINDS = new Set(['voice', 'text']);

// Retention: drop traffic (and its stored audio) older than this. Configurable via env.
const RETENTION_DAYS = Number(process.env.ZELLO_RETENTION_DAYS) || 120;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000; // sweep at most once an hour
let lastPruneAt = 0;

/** Best-effort retention sweep — deletes rows past the window. Throttled, fire-and-forget. */
async function pruneOldActivity(): Promise<void> {
  const now = Date.now();
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) return;
  lastPruneAt = now;
  const cutoff = new Date(now - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  try {
    await prisma.zelloActivity.deleteMany({ where: { at: { lt: cutoff } } });
  } catch {
    /* housekeeping is best-effort */
  }
}

type AuthUser = Parameters<typeof userHasRole>[0];

function canUse(user: AuthUser): boolean {
  return userHasRole(user, ADMIN_ROLE_NAME) || userHasModule(user, 'radio-zello');
}

/** Channel history — newest first — so the console can restore a channel after switching. */
export async function GET(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;
  if (!canUse(auth.user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  void pruneOldActivity();

  const { searchParams } = new URL(request.url);
  const channel = (searchParams.get('channel') ?? '').trim();
  if (!channel) return NextResponse.json({ items: [] });
  const network = (searchParams.get('network') ?? '').trim();
  const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 200, 1), 500);

  const items = await prisma.zelloActivity.findMany({
    where: { network, channel },
    orderBy: { at: 'desc' },
    take: limit,
    // Never load the audio bytes for the list — that's fetched lazily per clip on replay.
    select: {
      id: true,
      network: true,
      channel: true,
      kind: true,
      fromName: true,
      direction: true,
      text: true,
      transcript: true,
      translation: true,
      language: true,
      durationMs: true,
      hasAudio: true,
      at: true,
    },
  });
  return NextResponse.json({ items });
}

/** Record one piece of channel traffic (a voice transmission or a text message). */
export async function POST(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;
  if (!canUse(auth.user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  void pruneOldActivity();

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'bad-request' }, { status: 400 });

  const channel = String(body.channel ?? '').trim();
  const kind = String(body.kind ?? '').trim();
  if (!channel || !KINDS.has(kind)) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const atMs = typeof body.at === 'number' ? body.at : Date.now();
  const str = (v: unknown, max: number): string | null => {
    const s = v == null ? '' : String(v).trim();
    return s ? s.slice(0, max) : null;
  };

  const created = await prisma.zelloActivity.create({
    data: {
      network: String(body.network ?? '').trim(),
      channel,
      kind,
      fromName: str(body.from ?? body.fromName, 200) ?? 'Unknown',
      direction: String(body.direction ?? 'in').trim() === 'out' ? 'out' : 'in',
      text: str(body.text, 4000),
      transcript: str(body.transcript, 8000),
      translation: str(body.translation, 8000),
      language: str(body.language, 80),
      durationMs: typeof body.durationMs === 'number' ? Math.round(body.durationMs) : null,
      at: new Date(atMs),
      recordedById: auth.user.id,
    },
  });
  return NextResponse.json({ id: created.id });
}
