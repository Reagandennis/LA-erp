import { NextRequest, NextResponse } from 'next/server';

import { enforceRateLimit } from '@/lib/rate-limit';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireRequestAuth } from '@/lib/request-auth';
import { getUploadLimitMb, mbToBytes } from '@/lib/upload-limits';
import { userHasModule, userHasRole } from '@/lib/user';
import { transcribe, transmissionKey } from '@/lib/zello-transcription';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

/**
 * Transcribe a captured Zello transmission (audio body) using Gemini — once
 * per transmission, however many consoles send it (lib/zello-transcription.ts).
 */
export async function POST(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;
  if (!userHasRole(auth.user, ADMIN_ROLE_NAME) && !userHasModule(auth.user, 'radio-zello')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const rateLimit = await enforceRateLimit({
    scope: 'zello.transcribe',
    key: `${auth.user.id}`,
    limit: 30,
    windowMs: 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error: 'Too many transcription requests. Slow down and try again.',
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      },
      { status: 429 },
    );
  }

  const mimeType = (request.headers.get('content-type') ?? 'audio/wav').split(';')[0].trim() || 'audio/wav';
  const buffer = Buffer.from(await request.arrayBuffer());
  if (buffer.length === 0) return NextResponse.json({ error: 'empty' }, { status: 400 });
  const maxAudioMb = await getUploadLimitMb('audioMb');
  if (buffer.length > mbToBytes(maxAudioMb)) return NextResponse.json({ error: 'too-large' }, { status: 413 });

  const result = await transcribe({
    key: transmissionKey(request.headers.get('x-zello-transmission'), buffer),
    audio: buffer,
    mimeType,
    userId: auth.user.id,
  });
  return NextResponse.json(result);
}
