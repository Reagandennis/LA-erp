import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  requireRequestAuth: vi.fn(),
  enforceRateLimit: vi.fn(),
  importRoster: vi.fn(),
  rosterTemplateRows: vi.fn(),
  currentMonth: vi.fn(),
}));

vi.mock('../lib/request-auth', () => ({ requireRequestAuth: mocks.requireRequestAuth }));
vi.mock('../lib/rate-limit', () => ({ enforceRateLimit: mocks.enforceRateLimit }));
vi.mock('../lib/shift-planning', () => ({
  RosterError: class RosterError extends Error {},
  importRoster: mocks.importRoster,
  rosterTemplateRows: mocks.rosterTemplateRows,
  currentMonth: mocks.currentMonth,
}));

import { GET, POST } from '../app/api/shift-planning/admin/import/route';

const URL = 'http://localhost/api/shift-planning/admin/import';

function signedIn(options: { roles?: string[]; modules?: string[] } = { roles: ['admin'] }) {
  mocks.requireRequestAuth.mockResolvedValue({
    auth: {
      user: {
        id: 7,
        name: 'Test Scheduler',
        roles: (options.roles ?? []).map((name) => ({ name })),
        modules: (options.modules ?? []).map((slug) => ({ slug })),
      },
    },
    response: null,
  });
}

function upload(fields: Record<string, string | File>) {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  return new NextRequest(URL, { method: 'POST', body });
}

const csv = (text = 'Name,1,2\nMercy,D,N\n', name = 'november.csv') => new File([text], name, { type: 'text/csv' });

describe('roster upload route', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.enforceRateLimit.mockResolvedValue({ allowed: true });
    mocks.currentMonth.mockResolvedValue('2026-11');
    mocks.importRoster.mockResolvedValue({ applied: false, preview: { month: '2026-11' }, summary: null });
    signedIn();
  });

  it('is for schedulers only: staff are refused before the file is read', async () => {
    signedIn({ modules: ['shift-planning'] });
    expect((await POST(upload({ file: csv(), month: '2026-11' }))).status).toBe(403);
    expect((await GET(new NextRequest(`${URL}?month=2026-11`))).status).toBe(403);
    expect(mocks.importRoster).not.toHaveBeenCalled();
    expect(mocks.rosterTemplateRows).not.toHaveBeenCalled();

    mocks.requireRequestAuth.mockResolvedValue({ auth: null, response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) });
    expect((await POST(upload({ file: csv(), month: '2026-11' }))).status).toBe(401);
  });

  it('previews by default, with the file read into rows', async () => {
    signedIn({ modules: ['shift-planning-admin'] });
    const response = await POST(upload({ file: csv(), month: '2026-11' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ applied: false });
    expect(mocks.importRoster).toHaveBeenCalledWith(
      { id: 7, name: 'Test Scheduler' },
      {
        month: '2026-11',
        fileName: 'november.csv',
        sheets: [{ name: 'november', hidden: false, rows: [['Name', '1', '2'], ['Mercy', 'D', 'N']] }],
        sheet: null,
        blankAsOff: false,
        mapping: {},
        apply: false,
        forceReason: null,
      },
    );
  });

  it('passes on the choices made in the preview, dropping anything that is not one', async () => {
    await POST(
      upload({
        file: csv(),
        month: '2026-11',
        sheet: 'Nov',
        blankAsOff: '1',
        apply: '1',
        forceReason: 'Agreed cover',
        mapping: JSON.stringify({ mercy: 13, 'zz tester': 'new', kevin: 'skip', bad: 'drop table', worse: 1.5, none: null }),
      }),
    );
    expect(mocks.importRoster.mock.calls[0]?.[1]).toMatchObject({
      sheet: 'Nov',
      blankAsOff: true,
      apply: true,
      forceReason: 'Agreed cover',
      mapping: { mercy: 13, 'zz tester': 'new', kevin: 'skip' },
    });
  });

  it('turns away a request it cannot use, in words', async () => {
    const error = async (fields: Record<string, string | File>) => {
      const response = await POST(upload(fields));
      return [response.status, ((await response.json()) as { error: string }).error];
    };
    expect(await error({ month: '2026-11' })).toEqual([400, 'Choose the roster file to upload.']);
    expect(await error({ file: csv(), month: 'November' })).toEqual([400, 'Pick the month this roster is for.']);
    expect(await error({ file: csv(), month: '2026-11', mapping: '{not json' })).toEqual([400, 'Invalid request.']);
    expect((await error({ file: new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3, 4])], 'old.xls'), month: '2026-11' }))[1]).toMatch(/older Excel file/);
    expect((await error({ file: new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'huge.csv'), month: '2026-11' }))[1]).toMatch(/larger than 5 MB/);
    expect(mocks.importRoster).not.toHaveBeenCalled();
  });

  it('slows down someone uploading over and over', async () => {
    mocks.enforceRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 30 });
    const response = await POST(upload({ file: csv(), month: '2026-11' }));
    expect(response.status).toBe(429);
    expect(mocks.importRoster).not.toHaveBeenCalled();
  });

  it('hands the month back as a CSV that Excel opens', async () => {
    mocks.rosterTemplateRows.mockResolvedValue([
      ['Code', 'Name', '1', '2'],
      ['TRC-1', 'Enoch, Reagan', 'D', ''],
      ['TRC-2', 'Zoë "Zed"', 'N', 'X'],
    ]);
    const response = await GET(new NextRequest(`${URL}?month=2027-02`));
    expect(mocks.rosterTemplateRows).toHaveBeenCalledWith('2027-02');
    expect(response.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="roster-2027-02.csv"');
    const bytes = Buffer.from(await response.arrayBuffer());
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.subarray(3).toString('utf8')).toBe('Code,Name,1,2\r\nTRC-1,"Enoch, Reagan",D,\r\nTRC-2,"Zoë ""Zed""",N,X\r\n');

    // Without a month, the one it is now.
    await GET(new NextRequest(URL));
    expect(mocks.rosterTemplateRows).toHaveBeenLastCalledWith('2026-11');
  });
});
