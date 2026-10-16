import { NextRequest, NextResponse } from 'next/server';

import { API_ACCESS } from '@/lib/api-access';
import { requireModuleRequest } from '@/lib/request-auth';
import { toggleUpvote } from '@/lib/feedback';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseId(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ feedbackId: string }> },
) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.feedback);
  if (response || !auth) return response;

  const { feedbackId: raw } = await params;
  const feedbackId = parseId(raw);
  if (!feedbackId) {
    return NextResponse.json({ error: 'Invalid feedback id' }, { status: 400 });
  }

  const result = await toggleUpvote(auth.user.id, feedbackId);
  if (result === null) {
    return NextResponse.json({ error: 'Feedback not found' }, { status: 404 });
  }
  return NextResponse.json(result);
}
