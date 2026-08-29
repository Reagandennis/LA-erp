import { NextRequest, NextResponse } from 'next/server';

import { getBreadcrumb, listFiles } from '@/lib/google-drive';
import { driveErrorResponse, resolveDriveRequest } from '@/lib/google-drive-route';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

/** Browse a folder, or search the whole Drive when `q` is present. */
export async function GET(request: NextRequest) {
  const { ctx, response } = await resolveDriveRequest(request);
  if (response || !ctx) return response;

  const { searchParams } = new URL(request.url);
  const folderId = (searchParams.get('folderId') ?? 'root').trim() || 'root';
  const search = (searchParams.get('q') ?? '').trim();
  const pageToken = searchParams.get('pageToken') ?? undefined;

  try {
    const listing = await listFiles(ctx.token, { folderId, search, pageToken });
    // A search spans the whole Drive, so a folder trail would be misleading.
    const breadcrumb = search ? [] : await getBreadcrumb(ctx.token, folderId);
    return NextResponse.json({ ...listing, breadcrumb, folderId, search });
  } catch (error) {
    return driveErrorResponse(error);
  }
}
