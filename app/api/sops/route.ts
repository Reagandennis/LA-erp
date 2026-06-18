import { NextRequest, NextResponse } from 'next/server';

import { requireAdminRequest, requireRequestAuth } from '@/lib/request-auth';
import { createSop, getSopStats, listSops } from '@/lib/sops';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const [items, stats] = await Promise.all([listSops(auth.user.id), getSopStats()]);
  return NextResponse.json({ items, stats });
}

export async function POST(request: NextRequest) {
  const { auth, response } = await requireAdminRequest(request);
  if (response || !auth) return response;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  try {
    const item = await createSop({
      userId: auth.user.id,
      code: String(body.code ?? ''),
      title: String(body.title ?? ''),
      category: typeof body.category === 'string' ? body.category : undefined,
      status: typeof body.status === 'string' ? body.status : undefined,
      version: typeof body.version === 'string' ? body.version : undefined,
      ownerName: body.ownerName ?? null,
      description: body.description ?? null,
      steps: body.steps,
      effectiveDate: typeof body.effectiveDate === 'string' ? body.effectiveDate : null,
      reviewDate: typeof body.reviewDate === 'string' ? body.reviewDate : null,
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not create SOP';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
