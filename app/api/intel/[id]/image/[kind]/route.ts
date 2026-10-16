import { NextRequest, NextResponse } from 'next/server';

import { fileResponse } from '@/lib/file-response';
import { getAssessmentImage } from '@/lib/intel';
import { API_ACCESS } from '@/lib/api-access';
import { requireModuleRequest } from '@/lib/request-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseId(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; kind: string }> },
) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.intel);
  if (response || !auth) return response;

  const { id: raw, kind } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid assessment id' }, { status: 400 });
  if (kind !== 'map' && kind !== 'street') {
    return NextResponse.json({ error: 'Invalid image kind' }, { status: 400 });
  }

  const image = await getAssessmentImage(id, kind);
  if (!image) return NextResponse.json({ error: 'Image not found' }, { status: 404 });

  return fileResponse({
    content: image.content,
    mime: image.mime,
    name: `assessment-${id}-${kind}`,
    cacheControl: 'private, max-age=3600',
  });
}
