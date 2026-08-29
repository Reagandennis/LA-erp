import { NextRequest, NextResponse } from 'next/server';

import { fileResponse } from '@/lib/file-response';
import { DriveTooLargeError, getFileContent } from '@/lib/google-drive';
import { driveErrorResponse, resolveDriveRequest } from '@/lib/google-drive-route';
import { enforceRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

/**
 * Stream one Drive file through the app.
 *
 * Proxied rather than linked directly so the browser never needs the Google
 * token, and so bytes pass through `fileResponse` — the same helper that guards
 * in-app uploads, forcing anything not inline-safe to download instead of
 * rendering in this origin.
 */
export async function GET(request: NextRequest) {
  const { ctx, response } = await resolveDriveRequest(request);
  if (response || !ctx) return response;

  const { searchParams } = new URL(request.url);
  const fileId = (searchParams.get('fileId') ?? '').trim();
  if (!fileId) return NextResponse.json({ error: 'A fileId is required.' }, { status: 400 });
  const download = searchParams.get('download') === '1';

  // Every hit costs a Drive round-trip; a folder of images shouldn't be able to
  // hammer the API from one page load.
  const rateLimit = await enforceRateLimit({
    scope: 'drive.content',
    key: `${ctx.userId}`,
    limit: 300,
    windowMs: 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many file requests.' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    );
  }

  try {
    const content = await getFileContent(ctx.token, fileId);
    return fileResponse({
      content: content.bytes,
      mime: content.mimeType,
      name: content.fileName,
      download,
      // Private to this viewer, but worth reusing within a page.
      cacheControl: 'private, max-age=300',
    });
  } catch (error) {
    if (error instanceof DriveTooLargeError) {
      return NextResponse.json(
        { error: 'too-large', sizeBytes: error.sizeBytes },
        { status: 413 },
      );
    }
    return driveErrorResponse(error);
  }
}
