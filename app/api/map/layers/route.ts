import { NextRequest, NextResponse } from 'next/server';

import { createLayer, getMapWorkspace } from '@/lib/map-store';
import { requireModuleRequest } from '@/lib/request-auth';
import { mapLayerCreateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, 'map');
  if (response || !auth) return response;

  const { layers } = await getMapWorkspace();
  return NextResponse.json({ items: layers });
}

export async function POST(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, 'map');
  if (response || !auth) return response;

  const parsed = mapLayerCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid layer' }, { status: 400 });
  }

  const item = await createLayer(parsed.data, auth.user.id);
  return NextResponse.json({ item }, { status: 201 });
}
