import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { requireRequestAuth, myShifts, teamRoster, currentMonth } = vi.hoisted(() => ({
  requireRequestAuth: vi.fn(),
  myShifts: vi.fn(),
  teamRoster: vi.fn(),
  currentMonth: vi.fn(),
}));

vi.mock('../lib/request-auth', () => ({ requireRequestAuth }));
vi.mock('../lib/shift-planning', () => ({
  RosterError: class RosterError extends Error {},
  myShifts,
  teamRoster,
  currentMonth,
}));

import { GET as getMine } from '../app/api/shift-planning/me/route';
import { GET as getRoster } from '../app/api/shift-planning/roster/route';
import { requireManager, requireViewer } from '../lib/shift-planning-route';

const request = (path = '/api/shift-planning/me') => new NextRequest(`http://localhost${path}`);

function signedIn(options: { id?: number; roles?: string[]; modules?: string[] }) {
  requireRequestAuth.mockResolvedValue({
    auth: {
      user: {
        id: options.id ?? 7,
        name: 'Test User',
        roles: (options.roles ?? []).map((name) => ({ name })),
        modules: (options.modules ?? []).map((slug) => ({ slug })),
      },
    },
    response: null,
  });
}

describe('shift planning access', () => {
  beforeEach(() => {
    [requireRequestAuth, myShifts, teamRoster, currentMonth].forEach((m) => m.mockReset());
    currentMonth.mockResolvedValue('2026-12');
  });

  it('turns away someone who is not signed in', async () => {
    requireRequestAuth.mockResolvedValue({ auth: null, response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) });
    expect((await requireViewer(request())).response?.status).toBe(401);
  });

  it('turns away someone holding neither shift module', async () => {
    signedIn({ modules: ['calendar'] });
    expect((await requireViewer(request())).response?.status).toBe(403);
  });

  it('lets staff view but not manage', async () => {
    signedIn({ modules: ['shift-planning'] });
    const viewer = await requireViewer(request());
    expect(viewer.ctx).toEqual({ actor: { id: 7, name: 'Test User' }, canManage: false });
    expect((await requireManager(request())).response?.status).toBe(403);
  });

  it('treats an admin, and anyone granted Shift Planning Admin, as a scheduler', async () => {
    signedIn({ roles: ['admin'] });
    expect((await requireManager(request())).ctx?.canManage).toBe(true);
    signedIn({ modules: ['shift-planning-admin'] });
    expect((await requireManager(request())).ctx?.canManage).toBe(true);
  });

  it('gives staff their own shifts only: the roster of everyone is refused', async () => {
    signedIn({ id: 42, modules: ['shift-planning'] });
    myShifts.mockResolvedValue({ line: null });

    const mine = await getMine(request('/api/shift-planning/me?month=2027-01'));
    expect(mine.status).toBe(200);
    // Always the caller's own id, whatever the request says.
    expect(myShifts).toHaveBeenCalledWith(42, '2027-01');

    const everyone = await getRoster(request('/api/shift-planning/roster?month=2027-01'));
    expect(everyone.status).toBe(403);
    expect(teamRoster).not.toHaveBeenCalled();
  });

  it('gives an admin the roster of everyone', async () => {
    signedIn({ roles: ['admin'] });
    teamRoster.mockResolvedValue({ lines: [] });
    const everyone = await getRoster(request('/api/shift-planning/roster?month=bad'));
    expect(everyone.status).toBe(200);
    // A malformed month falls back to the current one.
    expect(teamRoster).toHaveBeenCalledWith('2026-12');
  });
});
