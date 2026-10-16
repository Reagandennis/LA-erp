import { NextRequest, NextResponse } from 'next/server';

import { fileResponse } from '@/lib/file-response';
import { API_ACCESS } from '@/lib/api-access';
import { requireModuleRequest } from '@/lib/request-auth';
import { deleteFile, getFileContent, updateFile } from '@/lib/files';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseId(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Serve the file (owner or shared-with only) — inline, or as a download with ?download=1.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.files);
  if (response || !auth) return response;

  const { fileId: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid file id' }, { status: 400 });

  const file = await getFileContent(id, auth.user.id);
  if (!file) return NextResponse.json({ error: 'File not found' }, { status: 404 });

  const download = request.nextUrl.searchParams.get('download') === '1';

  return fileResponse({
    content: file.content,
    mime: file.mime,
    name: file.name,
    download,
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.files);
  if (response || !auth) return response;

  const { fileId: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid file id' }, { status: 400 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const patch: { name?: string; description?: string | null; tags?: string[] } = {};
  if (typeof body.name === 'string') patch.name = body.name;
  if (typeof body.description === 'string' || body.description === null) {
    patch.description = body.description;
  }
  if (Array.isArray(body.tags) && body.tags.every((tag: unknown) => typeof tag === 'string')) {
    patch.tags = body.tags;
  }

  const result = await updateFile(id, auth.user.id, patch);
  if (result.status === 'not_found') {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }
  if (result.status === 'forbidden') {
    return NextResponse.json({ error: 'You can only edit files you uploaded' }, { status: 403 });
  }
  return NextResponse.json({ item: result.file });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.files);
  if (response || !auth) return response;

  const { fileId: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid file id' }, { status: 400 });

  const result = await deleteFile(id, auth.user.id);
  if (result === 'not_found') {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }
  if (result === 'forbidden') {
    return NextResponse.json({ error: 'You can only delete files you uploaded' }, { status: 403 });
  }
  return NextResponse.json({ deleted: true });
}
