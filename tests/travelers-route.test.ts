import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  requireModuleRequest,
  requireAdminRequest,
  listTravelers,
  searchTravelers,
  travelerStats,
  getTravelerById,
  createTraveler,
  listCustomerOptions,
} = vi.hoisted(() => ({
  requireModuleRequest: vi.fn(),
  requireAdminRequest: vi.fn(),
  listTravelers: vi.fn(),
  searchTravelers: vi.fn(),
  travelerStats: vi.fn(),
  getTravelerById: vi.fn(),
  createTraveler: vi.fn(),
  listCustomerOptions: vi.fn(),
}));

vi.mock('../lib/request-auth', () => ({ requireModuleRequest, requireAdminRequest }));
vi.mock('../lib/travelers', () => ({ listTravelers, searchTravelers, travelerStats, getTravelerById, createTraveler }));
vi.mock('../lib/contacts', () => ({ listCustomerOptions }));

import { GET, POST } from '../app/api/travelers/route';
import { GET as GET_ONE } from '../app/api/travelers/[id]/route';

const authed = { auth: { user: { id: 7 } }, response: undefined };

describe('travelers collection route', () => {
  beforeEach(() => {
    [
      requireModuleRequest,
      requireAdminRequest,
      listTravelers,
      searchTravelers,
      travelerStats,
      getTravelerById,
      createTraveler,
      listCustomerOptions,
    ].forEach((m) => m.mockReset());
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

  it('searches and pages in the database when asked to', async () => {
    requireModuleRequest.mockResolvedValue(authed);
    searchTravelers.mockResolvedValue({ items: [{ id: 1, name: 'Jane Doe' }], total: 41, page: 2, pageSize: 20 });
    travelerStats.mockResolvedValue({ total: 41, active: 40, elevatedRisk: 3, passportExpiring: 2 });

    const response = await GET(new NextRequest('http://localhost/api/travelers?q=jane&risk=High&status=Active&page=2&pageSize=20'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(searchTravelers).toHaveBeenCalledWith({ q: 'jane', risk: 'High', status: 'Active', page: 2, pageSize: 20 });
    expect(payload).toEqual({
      items: [{ id: 1, name: 'Jane Doe' }],
      total: 41,
      page: 2,
      pageSize: 20,
      stats: { total: 41, active: 40, elevatedRisk: 3, passportExpiring: 2 },
    });
    // The unpaged shape is for other callers; a search never loads everything.
    expect(listTravelers).not.toHaveBeenCalled();
  });

  it('treats a bad page number as the first page', async () => {
    requireModuleRequest.mockResolvedValue(authed);
    searchTravelers.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 60 });
    travelerStats.mockResolvedValue({ total: 0, active: 0, elevatedRisk: 0, passportExpiring: 0 });

    await GET(new NextRequest('http://localhost/api/travelers?page=abc'));

    expect(searchTravelers).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: null }));
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

describe('traveler detail route', () => {
  beforeEach(() => {
    [requireModuleRequest, getTravelerById].forEach((m) => m.mockReset());
  });

  it('is gated on the travelers module like the list', async () => {
    requireModuleRequest.mockResolvedValue({
      auth: null,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    });

    const response = await GET_ONE(new NextRequest('http://localhost/api/travelers/5'), {
      params: Promise.resolve({ id: '5' }),
    });

    expect(response.status).toBe(403);
    expect(getTravelerById).not.toHaveBeenCalled();
  });

  it('returns the full record', async () => {
    requireModuleRequest.mockResolvedValue(authed);
    getTravelerById.mockResolvedValue({ id: 5, name: 'Jane Doe', medicalNotes: 'Penicillin allergy' });

    const response = await GET_ONE(new NextRequest('http://localhost/api/travelers/5'), {
      params: Promise.resolve({ id: '5' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(getTravelerById).toHaveBeenCalledWith(5);
    expect(payload.item.medicalNotes).toBe('Penicillin allergy');
  });

  it('rejects a malformed id and reports a missing record', async () => {
    requireModuleRequest.mockResolvedValue(authed);
    getTravelerById.mockResolvedValue(null);

    const bad = await GET_ONE(new NextRequest('http://localhost/api/travelers/x'), { params: Promise.resolve({ id: 'x' }) });
    const missing = await GET_ONE(new NextRequest('http://localhost/api/travelers/9'), {
      params: Promise.resolve({ id: '9' }),
    });

    expect(bad.status).toBe(400);
    expect(missing.status).toBe(404);
  });
});
