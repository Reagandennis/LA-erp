import { NextRequest, NextResponse } from 'next/server';

import { requireAdminRequest } from '@/lib/request-auth';
import { getRecentAuditLogs } from '@/lib/user';

export async function GET(request: NextRequest) {
  const { response } = await requireAdminRequest(request);

  if (response) {
    return response;
  }

  const logs = await getRecentAuditLogs(50);
  return NextResponse.json({ logs });
}
