import { NextRequest, NextResponse } from 'next/server';

import { createNote, listNotes } from '@/lib/notes';
import { API_ACCESS } from '@/lib/api-access';
import { requireModuleRequest } from '@/lib/request-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.notes);
  if (response || !auth) return response;

  const items = await listNotes(auth.user.id);
  return NextResponse.json({ items });
}

export async function POST(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.notes);
  if (response || !auth) return response;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  try {
    const item = await createNote({
      userId: auth.user.id,
      title: String(body.title ?? ''),
      content: typeof body.content === 'string' ? body.content : '',
      category: typeof body.category === 'string' ? body.category : undefined,
      color: typeof body.color === 'string' ? body.color : undefined,
      pinned: typeof body.pinned === 'boolean' ? body.pinned : false,
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not create note';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
