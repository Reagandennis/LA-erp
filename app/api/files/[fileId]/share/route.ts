import { NextRequest, NextResponse } from 'next/server';

import { requireRequestAuth } from '@/lib/request-auth';
import { shareFile, unshareFile } from '@/lib/files';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseId(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Share a file with one or more users (owner only). Notifies both parties.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const { fileId: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid file id' }, { status: 400 });

  const body = await request.json().catch(() => null);
  const userIds = Array.isArray(body?.userIds) ? (body.userIds as unknown[]).map(Number) : [];
  const valid = userIds.filter((n) => Number.isInteger(n) && n > 0);
  if (valid.length === 0) {
    return NextResponse.json({ error: 'Select at least one user to share with' }, { status: 400 });
  }

  const result = await shareFile(id, auth.user.id, valid);
  if (result.status === 'not_found') {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }
  if (result.status === 'forbidden') {
    return NextResponse.json({ error: 'Only the uploader can share this file' }, { status: 403 });
  }
  return NextResponse.json({ item: result.file });
}

// Revoke a user's access to a shared file (owner only).
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const { fileId: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid file id' }, { status: 400 });

  const body = await request.json().catch(() => null);
  const recipientId = Number(body?.userId);
  if (!Number.isInteger(recipientId) || recipientId <= 0) {
    return NextResponse.json({ error: 'Invalid user id' }, { status: 400 });
  }

  const result = await unshareFile(id, auth.user.id, recipientId);
  if (result.status === 'not_found') {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }
  if (result.status === 'forbidden') {
    return NextResponse.json({ error: 'Only the uploader can manage sharing' }, { status: 403 });
  }
  return NextResponse.json({ item: result.file });
}
