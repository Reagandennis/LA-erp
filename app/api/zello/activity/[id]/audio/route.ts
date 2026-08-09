import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireRequestAuth } from '@/lib/request-auth';
import { getUploadLimitMb, mbToBytes } from '@/lib/upload-limits';
import { userHasModule, userHasRole } from '@/lib/user';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

type AuthUser = Parameters<typeof userHasRole>[0];
function canUse(user: AuthUser): boolean {
  return userHasRole(user, ADMIN_ROLE_NAME) || userHasModule(user, 'radio-zello');
}

/** Replay a stored transmission. Served as audio/wav so an <audio> element can play it. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;
  if (!canUse(auth.user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const id = Number((await params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'bad-id' }, { status: 400 });

  const row = await prisma.zelloActivity.findUnique({ where: { id }, select: { audio: true } });
  if (!row?.audio) return new NextResponse(null, { status: 404 });

  const bytes = row.audio as Buffer;
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'audio/wav',
      'Content-Length': String(bytes.length),
      'Cache-Control': 'private, max-age=86400',
    },
  });
}

/** Attach the recorded audio (WAV body) to an activity row. */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;
  if (!canUse(auth.user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const id = Number((await params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'bad-id' }, { status: 400 });

  const buf = Buffer.from(await request.arrayBuffer());
  if (buf.length === 0) return NextResponse.json({ error: 'empty' }, { status: 400 });
  const maxAudioMb = await getUploadLimitMb('audioMb');
  if (buf.length > mbToBytes(maxAudioMb)) return NextResponse.json({ error: 'too-large' }, { status: 413 });

  try {
    await prisma.zelloActivity.update({ where: { id }, data: { audio: buf, hasAudio: true } });
  } catch {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
