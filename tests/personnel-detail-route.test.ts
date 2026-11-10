import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { requireModuleRequest, getPersonnelById, updatePersonnel, deletePersonnel } = vi.hoisted(
  () => ({
    requireModuleRequest: vi.fn(),
    getPersonnelById: vi.fn(),
    updatePersonnel: vi.fn(),
    deletePersonnel: vi.fn(),
  }),
);

vi.mock('../lib/request-auth', () => ({ requireModuleRequest }));
vi.mock('../lib/personnel', () => ({ getPersonnelById, updatePersonnel, deletePersonnel }));

import { DELETE, GET, PATCH } from '../app/api/personnel/[id]/route';

const authed = { auth: { user: { id: 4 } }, response: undefined };

describe('personnel detail route', () => {
  beforeEach(() => {
    [requireModuleRequest, getPersonnelById, updatePersonnel, deletePersonnel].forEach((m) => m.mockReset());
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

describe('personnel detail route writes', () => {
  beforeEach(() => {
    [requireModuleRequest, updatePersonnel, deletePersonnel].forEach((m) => m.mockReset());
  });

  it('lets a people-module holder update and delete, not only admins', async () => {
    requireModuleRequest.mockResolvedValue(authed);
    updatePersonnel.mockResolvedValue({ id: 3, name: 'Jane Smith' });
    deletePersonnel.mockResolvedValue(true);

    const patched = await PATCH(
      new NextRequest('http://localhost/api/personnel/3', { method: 'PATCH', body: JSON.stringify({ name: 'Jane Smith' }) }),
      { params: Promise.resolve({ id: '3' }) },
    );
    const deleted = await DELETE(new NextRequest('http://localhost/api/personnel/3', { method: 'DELETE' }), {
      params: Promise.resolve({ id: '3' }),
    });

    expect(patched.status).toBe(200);
    expect(updatePersonnel).toHaveBeenCalledWith(3, { name: 'Jane Smith' });
    expect(deleted.status).toBe(200);
    expect(deletePersonnel).toHaveBeenCalledWith(3);
    for (const call of requireModuleRequest.mock.calls) {
      expect(call.slice(1)).toEqual(['personnel', 'drivers', 'cpos', 'airport-greeters', 'security-advisors']);
    }
  });

  it('refuses writes from a caller holding no people module', async () => {
    requireModuleRequest.mockResolvedValue({
      auth: null,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    });

    const patched = await PATCH(
      new NextRequest('http://localhost/api/personnel/3', { method: 'PATCH', body: JSON.stringify({ name: 'X' }) }),
      { params: Promise.resolve({ id: '3' }) },
    );

    expect(patched.status).toBe(403);
    expect(updatePersonnel).not.toHaveBeenCalled();
  });
});
