import { NextRequest, NextResponse } from 'next/server';

import { buildTripIntelReportDocxExport } from '@/lib/intel-report';
import { requireRequestAuth } from '@/lib/request-auth';

function parseTripId(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tripId: string }> },
) {
  const { auth, response } = await requireRequestAuth(request);

  if (response || !auth) {
    return response;
  }

  const { tripId: rawTripId } = await params;
  const tripId = parseTripId(rawTripId);

  if (!tripId) {
    return NextResponse.json({ error: 'Invalid trip id' }, { status: 400 });
  }

  const exportFile = await buildTripIntelReportDocxExport({
    tripId,
    actorUserId: auth.user.id,
    request,
  });

  if (!exportFile) {
    return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
  }

  return new NextResponse(exportFile.buffer as BodyInit, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(exportFile.fileName)}"`,
      'Content-Length': String(exportFile.buffer.byteLength),
      'Cache-Control': 'no-store',
    },
  });
}
