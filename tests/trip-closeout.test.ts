import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { findUnique, upsert, requireRequestAuth, recordAuditEvent } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
  requireRequestAuth: vi.fn(),
  recordAuditEvent: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({ prisma: { trip: { findUnique }, tripCloseout: { upsert } } }));
vi.mock('../lib/request-auth', () => ({
  // Module access has its own tests (request-auth-module); these cover the route itself.
  requireModuleRequest: (request: unknown) => requireRequestAuth(request),
}));
vi.mock('../lib/audit', () => ({ recordAuditEvent }));

import { PUT } from '../app/api/trips/[tripId]/closeout/route';
import { CLOSEOUT_CHECK_KEYS } from '../lib/trip-closeout-checks';
import { canCloseOutTrips, saveTripCloseout } from '../lib/trip-closeout';
import type { AccessUser } from '../lib/user';

function person(opts: { admin?: boolean; modules?: string[] } = {}): AccessUser {
  return {
    id: 7,
    email: 'v@example.test',
    name: 'V',
    status: 'active',
    createdAt: '',
    updatedAt: '',
    sessionVersion: 1,
    roles: opts.admin ? [{ id: 1, name: 'admin', description: '' }] : [{ id: 3, name: 'viewer', description: '' }],
    permissions: [],
    modules: (opts.modules ?? []).map((slug, i) => ({ id: i + 1, slug, name: slug, description: '', category: 'X', sortOrder: i })),
  };
}

const ALL = [...CLOSEOUT_CHECK_KEYS];
const closedAt = new Date('2026-10-01T10:00:00Z');

function tripRow(status: string, closeout: Record<string, unknown> | null = null) {
  return { reference: 'TR-2026-0001', status, closeout };
}

beforeEach(() => {
  findUnique.mockReset();
  upsert.mockReset();
  requireRequestAuth.mockReset();
  recordAuditEvent.mockReset();
  upsert.mockImplementation(async ({ update }: { update: Record<string, unknown> }) => ({
    checks: update.checks,
    summary: update.summary,
    issues: update.issues,
    clientFeedback: update.clientFeedback,
    closedAt: update.closedAt,
    updatedAt: new Date('2026-10-21T12:00:00Z'),
    closedBy: update.closedById ? { id: update.closedById, name: 'Closer' } : null,
    updatedBy: { id: update.updatedById, name: 'Editor' },
  }));
});

describe('canCloseOutTrips', () => {
  it('needs the Trip Close Out grant, not trip planning', () => {
    expect(canCloseOutTrips(person({ modules: ['trip-planning'] }))).toBe(false);
    expect(canCloseOutTrips(person({ modules: ['trip-closeout'] }))).toBe(true);
    expect(canCloseOutTrips(person({ admin: true }))).toBe(true);
  });
});

describe('saveTripCloseout', () => {
  it('refuses a trip that is not completed', async () => {
    findUnique.mockResolvedValue(tripRow('Active'));
    const result = await saveTripCloseout({ tripId: 1, userId: 7, input: { checks: ALL, closed: true } });
    expect(result).toEqual({ error: 'Only completed trips can be closed out', status: 400 });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('will not close out until every check is confirmed', async () => {
    findUnique.mockResolvedValue(tripRow('Completed'));
    const result = await saveTripCloseout({ tripId: 1, userId: 7, input: { checks: ['crew'], closed: true } });
    expect(result).toEqual({ error: 'Confirm every check before closing out', status: 400 });
  });

  it('saves progress on an open close-out', async () => {
    findUnique.mockResolvedValue(tripRow('Completed'));
    const result = await saveTripCloseout({
      tripId: 1,
      userId: 7,
      input: { checks: ['crew', 'itinerary', 'crew'], summary: 'Smooth', closed: false },
    });
    if ('error' in result) throw new Error(result.error);
    // Deduplicated, in checklist order.
    expect(result.closeout.checks).toEqual(['itinerary', 'crew']);
    expect(result.closeout.closedAt).toBeNull();
    expect(result.changed).toEqual(['checks', 'summary']);
  });

  it('closes out, recording who and when', async () => {
    findUnique.mockResolvedValue(tripRow('Completed'));
    const result = await saveTripCloseout({ tripId: 1, userId: 7, input: { checks: ALL, closed: true } });
    if ('error' in result) throw new Error(result.error);
    expect(result.wasClosed).toBe(false);
    expect(result.closeout.closedAt).not.toBeNull();
    expect(upsert.mock.calls[0]![0].update.closedById).toBe(7);
  });

  it('keeps a closed-out trip editable, even after its status moves on, without changing who closed it', async () => {
    findUnique.mockResolvedValue(
      tripRow('Active', { checks: ALL, summary: 'Old', issues: null, clientFeedback: null, closedAt, closedById: 3 }),
    );
    const result = await saveTripCloseout({
      tripId: 1,
      userId: 7,
      input: { checks: ALL, summary: 'Corrected', closed: true },
    });
    if ('error' in result) throw new Error(result.error);
    expect(result.wasClosed).toBe(true);
    expect(result.changed).toEqual(['summary']);
    const { update } = upsert.mock.calls[0]![0];
    expect(update).toMatchObject({ closedAt, closedById: 3, updatedById: 7 });
  });

  it('reopens', async () => {
    findUnique.mockResolvedValue(
      tripRow('Completed', { checks: ALL, summary: null, issues: null, clientFeedback: null, closedAt, closedById: 3 }),
    );
    const result = await saveTripCloseout({ tripId: 1, userId: 7, input: { checks: ['crew'], closed: false } });
    if ('error' in result) throw new Error(result.error);
    expect(result.closeout.closedAt).toBeNull();
    expect(upsert.mock.calls[0]![0].update.closedById).toBeNull();
  });
});

describe('PUT /api/trips/[tripId]/closeout', () => {
  const put = (body: unknown) =>
    PUT(new NextRequest('http://localhost/api/trips/1/closeout', { method: 'PUT', body: JSON.stringify(body) }), {
      params: Promise.resolve({ tripId: '1' }),
    });

  beforeEach(() => {
    requireRequestAuth.mockResolvedValue({ auth: { user: person({ modules: ['trip-closeout'] }) }, response: null });
  });

  it('rejects an unknown check', async () => {
    const r = await put({ checks: ['nope'], closed: false });
    expect(r.status).toBe(400);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('audits a close-out, then an edit, then a reopen', async () => {
    findUnique.mockResolvedValueOnce(tripRow('Completed'));
    expect((await put({ checks: ALL, closed: true })).status).toBe(200);

    const closed = { checks: ALL, summary: null, issues: null, clientFeedback: null, closedAt, closedById: 7 };
    findUnique.mockResolvedValueOnce(tripRow('Completed', closed));
    expect((await put({ checks: ALL, issues: 'Late pickup', closed: true })).status).toBe(200);

    findUnique.mockResolvedValueOnce(tripRow('Completed', closed));
    expect((await put({ checks: ALL, closed: false })).status).toBe(200);

    expect(recordAuditEvent.mock.calls.map(([event]) => event.action)).toEqual([
      'trip.closeout.closed',
      'trip.closeout.updated',
      'trip.closeout.reopened',
    ]);
    expect(recordAuditEvent.mock.calls[1]![0].metadata.changed).toEqual(['issues']);
  });
});
