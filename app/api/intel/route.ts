import { NextRequest, NextResponse } from 'next/server';

import { computeStats, createAssessment, isConfigured, listAssessments } from '@/lib/intel';
import { requireRequestAuth } from '@/lib/request-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
// Grounded generation + imagery can take a while.
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const assessments = await listAssessments();
  return NextResponse.json({
    assessments,
    stats: computeStats(assessments),
    configured: isConfigured(),
  });
}

export async function POST(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  if (!isConfigured()) {
    return NextResponse.json(
      { error: 'The AI service is not configured. Ask an administrator to set AI_ASSISTANT_API_KEY.' },
      { status: 503 },
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const location = typeof body.location === 'string' ? body.location : '';
  if (!location.trim()) {
    return NextResponse.json({ error: 'Enter a location or place to assess.' }, { status: 400 });
  }

  try {
    const item = await createAssessment({
      userId: auth.user.id,
      location,
      context: typeof body.context === 'string' ? body.context : null,
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not generate the assessment.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
