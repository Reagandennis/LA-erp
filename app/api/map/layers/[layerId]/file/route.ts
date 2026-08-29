import { NextRequest, NextResponse } from 'next/server';

import { fileResponse } from '@/lib/file-response';
import { getLayerFile } from '@/lib/map-store';
import { requireModuleRequest } from '@/lib/request-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** Hand back the original .kmz/.kml/.csv exactly as it was uploaded. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ layerId: string }> },
) {
  const { auth, response } = await requireModuleRequest(request, 'map');
  if (response || !auth) return response;

  const id = Number((await params).layerId);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'Invalid layer' }, { status: 400 });

  const file = await getLayerFile(id);
  if (!file) return NextResponse.json({ error: 'This layer has no source file' }, { status: 404 });

  return fileResponse({ content: file.content, mime: file.mime, name: file.name, download: true });
}
