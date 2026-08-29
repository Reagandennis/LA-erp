import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { requireModuleRequest, requireAdminRequest, listTravelers, createTraveler, listCustomerOptions } =
  vi.hoisted(() => ({
    requireModuleRequest: vi.fn(),
    requireAdminRequest: vi.fn(),
    listTravelers: vi.fn(),
    createTraveler: vi.fn(),
    listCustomerOptions: vi.fn(),
  }));

vi.mock('../lib/request-auth', () => ({ requireModuleRequest, requireAdminRequest }));
vi.mock('../lib/travelers', () => ({ listTravelers, createTraveler }));
vi.mock('../lib/contacts', () => ({ listCustomerOptions }));

import { GET, POST } from '../app/api/travelers/route';

const authed = { auth: { user: { id: 7 } }, response: undefined };

describe('travelers collection route', () => {
  beforeEach(() => {
    [requireModuleRequest, requireAdminRequest, listTravelers, createTraveler, listCustomerOptions]
      .forEach((m) => m.mockReset());
  });

  it('refuses callers without the travelers module', async () => {
    // Protectee PII is gated on the module grant, not merely on being signed in.
    requireModuleRequest.mockResolvedValue({
      auth: null,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    });

    const response = await GET(new NextRequest('http://localhost/api/travelers'));

    expect(response.status).toBe(403);
    expect(requireModuleRequest).toHaveBeenCalledWith(expect.anything(), 'travelers');
    expect(listTravelers).not.toHaveBeenCalled();
  });

  it('returns travellers and customer options together', async () => {
    requireModuleRequest.mockResolvedValue(authed);
    listTravelers.mockResolvedValue([{ id: 1, name: 'Jane Doe' }]);
    listCustomerOptions.mockResolvedValue([{ id: 2, name: 'Acme', company: 'Acme Ltd' }]);

    const response = await GET(new NextRequest('http://localhost/api/travelers'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.items).toHaveLength(1);
    expect(payload.customers).toHaveLength(1);
  });

  it('requires admin to create a traveller', async () => {
    requireAdminRequest.mockResolvedValue({
      auth: null,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    });

    const response = await POST(
      new NextRequest('http://localhost/api/travelers', {
        method: 'POST',
        body: JSON.stringify({ name: 'Jane Doe' }),
      }),
    );

    expect(response.status).toBe(403);
    expect(createTraveler).not.toHaveBeenCalled();
  });

  it('creates a traveller and stamps the acting user', async () => {
    requireAdminRequest.mockResolvedValue(authed);
    createTraveler.mockResolvedValue({ id: 3, name: 'Jane Doe' });

    const response = await POST(
      new NextRequest('http://localhost/api/travelers', {
        method: 'POST',
        body: JSON.stringify({ name: 'Jane Doe', riskLevel: 'High', customerId: 2 }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.item.id).toBe(3);
    expect(createTraveler).toHaveBeenCalledWith(
      expect.objectContaining({ createdById: 7, name: 'Jane Doe', riskLevel: 'High', customerId: 2 }),
    );
  });

  it('surfaces a validation failure as a 400', async () => {
    requireAdminRequest.mockResolvedValue(authed);
    createTraveler.mockRejectedValue(new Error('Name is required'));

    const response = await POST(
      new NextRequest('http://localhost/api/travelers', {
        method: 'POST',
        body: JSON.stringify({ name: '' }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Name is required');
  });
});
