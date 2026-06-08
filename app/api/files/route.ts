import { NextRequest, NextResponse } from 'next/server';

import { requireRequestAuth } from '@/lib/request-auth';
import { computeStats, createFiles, listFiles } from '@/lib/files';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB per file

export async function GET(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const items = await listFiles(auth.user.id);
  return NextResponse.json({
    items,
    stats: computeStats(items),
    viewer: { id: auth.user.id },
  });
}

export async function POST(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

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

  const toStore: Array<{ name: string; mime: string; size: number; content: Buffer }> = [];
  for (const file of files) {
    if (!(file instanceof File) || file.size === 0) continue;
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: `"${file.name}" exceeds the 25 MB per-file limit` },
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
