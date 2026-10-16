import { NextRequest, NextResponse } from 'next/server';

import { deleteNote, updateNote } from '@/lib/notes';
import { API_ACCESS } from '@/lib/api-access';
import { requireModuleRequest } from '@/lib/request-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseId(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.notes);
  if (response || !auth) return response;

  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid note id' }, { status: 400 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const patch: { title?: string; content?: string; category?: string; color?: string; pinned?: boolean } = {};
  if (typeof body.title === 'string') patch.title = body.title;
  if (typeof body.content === 'string') patch.content = body.content;
  if (typeof body.category === 'string') patch.category = body.category;
  if (typeof body.color === 'string') patch.color = body.color;
  if (typeof body.pinned === 'boolean') patch.pinned = body.pinned;

  const item = await updateNote(id, auth.user.id, patch);
  if (item === null) return NextResponse.json({ error: 'Note not found' }, { status: 404 });
  return NextResponse.json({ item });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.notes);
  if (response || !auth) return response;

  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid note id' }, { status: 400 });

  const ok = await deleteNote(id, auth.user.id);
  if (!ok) return NextResponse.json({ error: 'Note not found' }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
