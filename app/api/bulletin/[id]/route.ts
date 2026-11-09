import { NextRequest, NextResponse } from 'next/server';

import { API_ACCESS } from '@/lib/api-access';
import { deletePost, getPost, isAuthor, updatePost } from '@/lib/bulletin';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireModuleRequest } from '@/lib/request-auth';
import { userHasRole } from '@/lib/user';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseId(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** One notice with everyone who has seen it. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.bulletin);
  if (response || !auth) return response;

  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid post id' }, { status: 400 });

  const item = await getPost(id, auth.user.id);
  if (!item) return NextResponse.json({ error: 'Notice not found' }, { status: 404 });
  return NextResponse.json({ item });
}

/** Only the author or an admin may change or take down a notice. */
async function allowed(id: number, user: Parameters<typeof userHasRole>[0]): Promise<NextResponse | null> {
  const author = await isAuthor(id, user.id);
  if (author === null) return NextResponse.json({ error: 'Notice not found' }, { status: 404 });
  if (!author && !userHasRole(user, ADMIN_ROLE_NAME)) {
    return NextResponse.json({ error: 'Only the author or an admin can change this notice' }, { status: 403 });
  }
  return null;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.bulletin);
  if (response || !auth) return response;

  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid post id' }, { status: 400 });
  const denied = await allowed(id, auth.user);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const patch: { title?: string; body?: string; category?: string; pinned?: boolean; expiresAt?: string | null } = {};
  if (typeof body.title === 'string') patch.title = body.title;
  if (typeof body.body === 'string') patch.body = body.body;
  if (typeof body.category === 'string') patch.category = body.category;
  if (typeof body.pinned === 'boolean') patch.pinned = body.pinned;
  if (typeof body.expiresAt === 'string' || body.expiresAt === null) patch.expiresAt = body.expiresAt;

  try {
    const item = await updatePost(id, auth.user.id, patch);
    if (item === null) return NextResponse.json({ error: 'Notice not found' }, { status: 404 });
    return NextResponse.json({ item });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not save the notice';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.bulletin);
  if (response || !auth) return response;

  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid post id' }, { status: 400 });
  const denied = await allowed(id, auth.user);
  if (denied) return denied;

  const ok = await deletePost(id);
  if (!ok) return NextResponse.json({ error: 'Notice not found' }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
