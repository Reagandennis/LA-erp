import { NextRequest, NextResponse } from 'next/server';

import { requireRequestAuth } from '@/lib/request-auth';
import { createFeedback, getFeedbackStats, listFeedback } from '@/lib/feedback';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const [items, stats] = await Promise.all([
    listFeedback(auth.user.id),
    getFeedbackStats(),
  ]);
  return NextResponse.json({ items, stats });
}

export async function POST(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const body = await request.json().catch(() => null);
  const title = typeof body?.title === 'string' ? body.title : '';
  const description = typeof body?.description === 'string' ? body.description : '';
  const category = typeof body?.category === 'string' ? body.category : 'Improvement';

  try {
    const item = await createFeedback({
      userId: auth.user.id,
      title,
      description,
      category,
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not submit feedback';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
