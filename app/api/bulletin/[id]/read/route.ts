import { NextRequest, NextResponse } from 'next/server';

import { API_ACCESS } from '@/lib/api-access';
import { markRead } from '@/lib/bulletin';
import { requireModuleRequest } from '@/lib/request-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** The caller has seen this notice. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.bulletin);
  if (response || !auth) return response;

  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Invalid post id' }, { status: 400 });

  const item = await markRead(id, auth.user.id);
  if (!item) return NextResponse.json({ error: 'Notice not found' }, { status: 404 });
  return NextResponse.json({ item });
}
