import { NextRequest, NextResponse } from 'next/server';

import { createFolder } from '@/lib/google-drive';
import { driveErrorResponse, resolveDriveRequest } from '@/lib/google-drive-route';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const { ctx, response } = await resolveDriveRequest(request);
  if (response || !ctx) return response;

  const body = (await request.json().catch(() => null)) as
    | { name?: unknown; parentId?: unknown }
    | null;
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const parentId = typeof body?.parentId === 'string' ? body.parentId.trim() : undefined;
  if (!name) return NextResponse.json({ error: 'A folder name is required.' }, { status: 400 });

  try {
    return NextResponse.json({ file: await createFolder(ctx.token, name, parentId) });
  } catch (error) {
    return driveErrorResponse(error);
  }
}
