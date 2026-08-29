import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { requireModuleRequest, requireAdminRequest, listPersonnel, listUserOptions, createPersonnel } =
  vi.hoisted(() => ({
    requireModuleRequest: vi.fn(),
    requireAdminRequest: vi.fn(),
    listPersonnel: vi.fn(),
    listUserOptions: vi.fn(),
    createPersonnel: vi.fn(),
  }));

vi.mock('../lib/request-auth', () => ({ requireModuleRequest, requireAdminRequest }));
vi.mock('../lib/personnel', () => ({ listPersonnel, listUserOptions, createPersonnel }));

import { GET, POST } from '../app/api/personnel/route';

const authed = { auth: { user: { id: 4 } }, response: undefined };

describe('personnel collection route', () => {
  beforeEach(() => {
    [requireModuleRequest, requireAdminRequest, listPersonnel, listUserOptions, createPersonnel]
      .forEach((m) => m.mockReset());
    listUserOptions.mockResolvedValue([]);
    listPersonnel.mockResolvedValue([]);
  });

  it('accepts any of the five people-module grants', async () => {
    requireModuleRequest.mockResolvedValue(authed);

    await GET(new NextRequest('http://localhost/api/personnel'));

    expect(requireModuleRequest).toHaveBeenCalledWith(
      expect.anything(),
      'personnel',
      'drivers',
      'cpos',
      'airport-greeters',
      'security-advisors',
    );
  });

  it('refuses a caller holding none of them', async () => {
    requireModuleRequest.mockResolvedValue({
      auth: null,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    });

    const response = await GET(new NextRequest('http://localhost/api/personnel'));

    expect(response.status).toBe(403);
    expect(listPersonnel).not.toHaveBeenCalled();
  });

  it('filters by a recognised role', async () => {
    requireModuleRequest.mockResolvedValue(authed);

    await GET(new NextRequest('http://localhost/api/personnel?role=CPO'));

    expect(listPersonnel).toHaveBeenCalledWith({ role: 'CPO' });
  });

  it('ignores an unrecognised role rather than returning nothing', async () => {
    requireModuleRequest.mockResolvedValue(authed);

    await GET(new NextRequest('http://localhost/api/personnel?role=Astronaut'));

    expect(listPersonnel).toHaveBeenCalledWith({ role: null });
  });

  it('passes the multi-role array through on create', async () => {
    requireAdminRequest.mockResolvedValue(authed);
    createPersonnel.mockResolvedValue({ id: 11, name: 'Jane Doe' });

    const response = await POST(
      new NextRequest('http://localhost/api/personnel', {
        method: 'POST',
        body: JSON.stringify({ name: 'Jane Doe', roles: ['CPO', 'Driver'], engagement: 'Vendor' }),
      }),
    );

    expect(response.status).toBe(201);
    expect(createPersonnel).toHaveBeenCalledWith(
      expect.objectContaining({ roles: ['CPO', 'Driver'], engagement: 'Vendor', createdById: 4 }),
    );
  });
});
