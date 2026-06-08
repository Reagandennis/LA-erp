import { NextRequest, NextResponse } from 'next/server';

import { requireAdminRequest } from '@/lib/request-auth';
import { isValidStatus, updateFeedbackStatus } from '@/lib/feedback';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseId(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ feedbackId: string }> },
) {
  const { auth, response } = await requireAdminRequest(request);
  if (response || !auth) return response;

  const { feedbackId: raw } = await params;
  const feedbackId = parseId(raw);
  if (!feedbackId) {
    return NextResponse.json({ error: 'Invalid feedback id' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const status = typeof body?.status === 'string' ? body.status : '';
  if (!isValidStatus(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }

  const ok = await updateFeedbackStatus(feedbackId, status);
  if (!ok) {
    return NextResponse.json({ error: 'Feedback not found' }, { status: 404 });
  }
  return NextResponse.json({ status });
}
