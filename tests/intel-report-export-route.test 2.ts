import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { buildTripIntelReportDocxExport, requireRequestAuth } = vi.hoisted(() => ({
  buildTripIntelReportDocxExport: vi.fn(),
  requireRequestAuth: vi.fn(),
}));

vi.mock('../lib/intel-report', () => ({
  buildTripIntelReportDocxExport,
}));

vi.mock('../lib/request-auth', () => ({
  requireRequestAuth,
}));

import { GET } from '../app/api/trip-planning/trips/[tripId]/intel-report/export/route';

describe('trip intel report export route', () => {
  beforeEach(() => {
    buildTripIntelReportDocxExport.mockReset();
    requireRequestAuth.mockReset();
  });

  it('returns auth response when unauthenticated', async () => {
    requireRequestAuth.mockResolvedValue({
      auth: null,
      response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
    });

    const response = await GET(
      new NextRequest('http://localhost/api/trip-planning/trips/4/intel-report/export'),
      { params: Promise.resolve({ tripId: '4' }) },
    );

    expect(response?.status).toBe(401);
    expect(buildTripIntelReportDocxExport).not.toHaveBeenCalled();
  });

  it('returns bad request for an invalid trip id', async () => {
    requireRequestAuth.mockResolvedValue({
      auth: { user: { id: 7 } },
      response: null,
    });

    const response = await GET(
      new NextRequest('http://localhost/api/trip-planning/trips/nope/intel-report/export'),
      { params: Promise.resolve({ tripId: 'nope' }) },
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Invalid trip id');
  });

  it('returns not found when the trip is unavailable', async () => {
    requireRequestAuth.mockResolvedValue({
      auth: { user: { id: 7 } },
      response: null,
    });
    buildTripIntelReportDocxExport.mockResolvedValue(null);

    const response = await GET(
      new NextRequest('http://localhost/api/trip-planning/trips/44/intel-report/export'),
      { params: Promise.resolve({ tripId: '44' }) },
    );
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toBe('Trip not found');
  });

  it('returns a DOCX attachment for a valid trip', async () => {
    requireRequestAuth.mockResolvedValue({
      auth: { user: { id: 7 } },
      response: null,
    });
    buildTripIntelReportDocxExport.mockResolvedValue({
      buffer: Buffer.from('docx-bytes'),
      fileName: 'nairobi-intel-report.docx',
    });

    const response = await GET(
      new NextRequest('http://localhost/api/trip-planning/trips/12/intel-report/export'),
      { params: Promise.resolve({ tripId: '12' }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(response.headers.get('Content-Disposition')).toContain('nairobi-intel-report.docx');
    expect(buildTripIntelReportDocxExport).toHaveBeenCalledWith({
      tripId: 12,
      actorUserId: 7,
      request: expect.any(NextRequest),
    });
  });
});
