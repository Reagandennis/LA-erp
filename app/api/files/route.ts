import { NextRequest, NextResponse } from 'next/server';

import { enforceRateLimit } from '@/lib/rate-limit';
import { API_ACCESS } from '@/lib/api-access';
import { requireModuleRequest } from '@/lib/request-auth';
import { getUploadLimitMb, mbToBytes } from '@/lib/upload-limits';
import { computeStats, createFiles, listFiles } from '@/lib/files';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.files);
  if (response || !auth) return response;

  const items = await listFiles(auth.user.id);
  return NextResponse.json({
    items,
    stats: computeStats(items),
    viewer: { id: auth.user.id },
  });
}

export async function POST(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.files);
  if (response || !auth) return response;

  const rateLimit = await enforceRateLimit({
    scope: 'file.upload',
    key: `${auth.user.id}`,
    limit: 20,
    windowMs: 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error: 'Too many uploads. Slow down and try again.',
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      },
      { status: 429 },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const files = formData.getAll('files');
  if (!files.length) {
    return NextResponse.json({ error: 'No files uploaded' }, { status: 400 });
  }

  const maxFileMb = await getUploadLimitMb('fileMb');
  const toStore: Array<{ name: string; mime: string; size: number; content: Buffer }> = [];
  for (const file of files) {
    if (!(file instanceof File) || file.size === 0) continue;
    if (file.size > mbToBytes(maxFileMb)) {
      return NextResponse.json(
        { error: `"${file.name}" exceeds the ${maxFileMb} MB per-file limit` },
        { status: 400 },
      );
    }
    toStore.push({
      name: file.name,
      mime: file.type || 'application/octet-stream',
      size: file.size,
      content: Buffer.from(await file.arrayBuffer()),
    });
  }

  if (toStore.length === 0) {
    return NextResponse.json({ error: 'No valid files uploaded' }, { status: 400 });
  }

  const created = await createFiles(auth.user.id, toStore);
  return NextResponse.json({ items: created }, { status: 201 });
}
