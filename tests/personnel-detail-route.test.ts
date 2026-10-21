import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { requireModuleRequest, requireAdminRequest, getPersonnelById, updatePersonnel, deletePersonnel } = vi.hoisted(
  () => ({
    requireModuleRequest: vi.fn(),
    requireAdminRequest: vi.fn(),
    getPersonnelById: vi.fn(),
    updatePersonnel: vi.fn(),
    deletePersonnel: vi.fn(),
  }),
);

vi.mock('../lib/request-auth', () => ({ requireModuleRequest, requireAdminRequest }));
vi.mock('../lib/personnel', () => ({ getPersonnelById, updatePersonnel, deletePersonnel }));

import { GET } from '../app/api/personnel/[id]/route';

const authed = { auth: { user: { id: 4 } }, response: undefined };

describe('personnel detail route', () => {
  beforeEach(() => {
    [requireModuleRequest, requireAdminRequest, getPersonnelById].forEach((m) => m.mockReset());
  });

  it('accepts any of the five people-module grants, like the list', async () => {
    requireModuleRequest.mockResolvedValue(authed);
    getPersonnelById.mockResolvedValue({ id: 3, name: 'Jane Doe', notes: 'Long profile text' });

    const response = await GET(new NextRequest('http://localhost/api/personnel/3'), {
      params: Promise.resolve({ id: '3' }),
    });
    const payload = await response.json();

    expect(requireModuleRequest).toHaveBeenCalledWith(
      expect.anything(),
      'personnel',
      'drivers',
      'cpos',
      'airport-greeters',
      'security-advisors',
    );
    expect(response.status).toBe(200);
    expect(getPersonnelById).toHaveBeenCalledWith(3);
    // The list leaves notes out; the detail is where they come from.
    expect(payload.item.notes).toBe('Long profile text');
  });

  it('refuses a caller holding none of them', async () => {
    requireModuleRequest.mockResolvedValue({
      auth: null,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    });

    const response = await GET(new NextRequest('http://localhost/api/personnel/3'), {
      params: Promise.resolve({ id: '3' }),
    });

    expect(response.status).toBe(403);
    expect(getPersonnelById).not.toHaveBeenCalled();
  });

  it('rejects a malformed id and reports a missing record', async () => {
    requireModuleRequest.mockResolvedValue(authed);
    getPersonnelById.mockResolvedValue(null);

    const bad = await GET(new NextRequest('http://localhost/api/personnel/x'), { params: Promise.resolve({ id: 'x' }) });
    const missing = await GET(new NextRequest('http://localhost/api/personnel/9'), {
      params: Promise.resolve({ id: '9' }),
    });

    expect(bad.status).toBe(400);
    expect(missing.status).toBe(404);
  });
});
