import { NextRequest, NextResponse } from 'next/server';

import { fileResponse } from '@/lib/file-response';
import { getSharedAttachment } from '@/lib/trip-share';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Public: a photo or document on a client's share link (`?thumb=1` for the
 * preview, `?download=1` to save it). The token is the credential, checked in
 * lib/trip-share.ts along with whether the link still shares attachments.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string; attachmentId: string }> },
) {
  const { token, attachmentId: raw } = await params;
  const attachmentId = Number(raw);
  if (!Number.isInteger(attachmentId) || attachmentId <= 0) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  const sp = request.nextUrl.searchParams;
  const file = await getSharedAttachment({ token, attachmentId, thumbnail: sp.get('thumb') === '1' });
  if (!file) return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });

  const response = fileResponse({
    ...file,
    download: sp.get('download') === '1',
    // Short-lived, so turning the link off (or attachments off) takes hold soon on the client's side too.
    cacheControl: 'private, max-age=300',
  });
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Robots-Tag', 'noindex');
  return response;
}
