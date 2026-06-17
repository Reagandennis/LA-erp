import { NextRequest, NextResponse } from 'next/server';

import { getAssessment } from '@/lib/intel';
import { buildIntelPdf } from '@/lib/intel-pdf';
import { requireRequestAuth } from '@/lib/request-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseId(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function safeFilename(title: string): string {
  const base = title.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'assessment';
  return `intel-${base}.pdf`;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid assessment id' }, { status: 400 });

  const assessment = await getAssessment(id);
  if (!assessment) return NextResponse.json({ error: 'Assessment not found' }, { status: 404 });

  const buffer = await buildIntelPdf(assessment);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${safeFilename(assessment.title)}"`,
    },
  });
}
