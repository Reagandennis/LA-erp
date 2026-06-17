import { NextRequest, NextResponse } from 'next/server';

import { deleteAssessment, getAssessment } from '@/lib/intel';
import { requireRequestAuth } from '@/lib/request-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseId(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid assessment id' }, { status: 400 });

  const item = await getAssessment(id);
  if (!item) return NextResponse.json({ error: 'Assessment not found' }, { status: 404 });
  return NextResponse.json({ item });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid assessment id' }, { status: 400 });

  const ok = await deleteAssessment(id);
  if (!ok) return NextResponse.json({ error: 'Assessment not found' }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
