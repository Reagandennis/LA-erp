import { NextRequest, NextResponse } from 'next/server';

import { getMapWorkspace, upsertDeviceTag } from '@/lib/map-store';
import { requireModuleRequest } from '@/lib/request-auth';
import { mapDeviceTagUpdateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, 'map');
  if (response || !auth) return response;

  const { deviceTags } = await getMapWorkspace();
  return NextResponse.json({ items: deviceTags });
}

/** Upsert by device name — tracked devices come and go, the username does not. */
export async function PUT(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, 'map');
  if (response || !auth) return response;

  const parsed = mapDeviceTagUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid device' }, { status: 400 });
  }

  const { device, ...patch } = parsed.data;
  const item = await upsertDeviceTag(device, patch);
  return NextResponse.json({ item });
}
