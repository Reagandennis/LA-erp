import { NextRequest, NextResponse } from 'next/server';

import type { GeoGeometry } from '@/lib/geo-geometry';
import { createFeature, layerExists, listLayerFeatures } from '@/lib/map-store';
import { enforceRateLimit } from '@/lib/rate-limit';
import { requireModuleRequest } from '@/lib/request-auth';
import { mapFeatureCreateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ layerId: string }> },
) {
  const { auth, response } = await requireModuleRequest(request, 'map');
  if (response || !auth) return response;

  const id = Number((await params).layerId);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'Invalid layer' }, { status: 400 });

  return NextResponse.json({ items: await listLayerFeatures(id) });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ layerId: string }> },
) {
  const { auth, response } = await requireModuleRequest(request, 'map');
  if (response || !auth) return response;

  const id = Number((await params).layerId);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'Invalid layer' }, { status: 400 });

  // Drawing generates bursts, so the ceiling is high but not absent.
  const rateLimit = await enforceRateLimit({
    scope: 'map.feature.create',
    key: `${auth.user.id}`,
    limit: 300,
    windowMs: 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many shapes at once. Pause a moment.', retryAfterSeconds: rateLimit.retryAfterSeconds },
      { status: 429 },
    );
  }

  const parsed = mapFeatureCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid shape' }, { status: 400 });
  }

  if (!(await layerExists(id))) {
    return NextResponse.json({ error: 'Layer not found' }, { status: 404 });
  }

  try {
    const item = await createFeature({
      layerId: id,
      ...parsed.data,
      geometry: parsed.data.geometry as unknown as GeoGeometry,
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    // Report what actually failed — a blanket "Layer not found" here hid a real bug.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not save the shape' },
      { status: 400 },
    );
  }
}
