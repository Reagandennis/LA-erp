import { NextRequest, NextResponse } from 'next/server';

import { getQuota } from '@/lib/google-drive';
import { driveErrorResponse, resolveDriveRequest } from '@/lib/google-drive-route';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

/** Storage quota and the connected Google identity. */
export async function GET(request: NextRequest) {
  const { ctx, response } = await resolveDriveRequest(request);
  if (response || !ctx) return response;
  try {
    return NextResponse.json(await getQuota(ctx.token));
  } catch (error) {
    return driveErrorResponse(error);
  }
}
