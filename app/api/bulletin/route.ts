import { NextRequest, NextResponse } from 'next/server';

import { API_ACCESS } from '@/lib/api-access';
import { computeStats, createPost, listPosts } from '@/lib/bulletin';
import { requireModuleRequest } from '@/lib/request-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** The board as the caller sees it. `?all=1` includes expired notices. */
export async function GET(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.bulletin);
  if (response || !auth) return response;

  const includeExpired = request.nextUrl.searchParams.get('all') === '1';
  const posts = await listPosts(auth.user.id, { includeExpired });
  return NextResponse.json({ posts, stats: computeStats(posts) });
}

export async function POST(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.bulletin);
  if (response || !auth) return response;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  try {
    const item = await createPost({
      userId: auth.user.id,
      title: String(body.title ?? ''),
      body: String(body.body ?? ''),
      category: typeof body.category === 'string' ? body.category : undefined,
      pinned: body.pinned === true,
      expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : null,
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not post the notice';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
