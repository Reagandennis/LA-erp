import { NextRequest, NextResponse } from 'next/server';

import { requireRequestAuth } from '@/lib/request-auth';
import { addComment, listComments } from '@/lib/feedback';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseId(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ feedbackId: string }> },
) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const { feedbackId: raw } = await params;
  const feedbackId = parseId(raw);
  if (!feedbackId) {
    return NextResponse.json({ error: 'Invalid feedback id' }, { status: 400 });
  }

  const comments = await listComments(feedbackId);
  if (comments === null) {
    return NextResponse.json({ error: 'Feedback not found' }, { status: 404 });
  }
  return NextResponse.json({ comments });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ feedbackId: string }> },
) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const { feedbackId: raw } = await params;
  const feedbackId = parseId(raw);
  if (!feedbackId) {
    return NextResponse.json({ error: 'Invalid feedback id' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const text = typeof body?.body === 'string' ? body.body : '';
  if (!text.trim()) {
    return NextResponse.json({ error: 'Comment body is required' }, { status: 400 });
  }

  const comment = await addComment(auth.user.id, feedbackId, text);
  if (comment === null) {
    return NextResponse.json({ error: 'Feedback not found' }, { status: 404 });
  }
  return NextResponse.json({ comment }, { status: 201 });
}
