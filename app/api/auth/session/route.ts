import { NextRequest, NextResponse } from 'next/server';

import { requireRequestAuth } from '@/lib/request-auth';

export async function GET(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);

  if (response || !auth) {
    return response;
  }

  return NextResponse.json({
    success: true,
    session: {
      id: auth.sessionId,
      expiresAt: auth.expiresAt,
    },
    user: auth.user,
  });
}
