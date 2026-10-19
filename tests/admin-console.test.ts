import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  requireAdminRequest,
  enforceRateLimit,
  recordAuditEvent,
  findRole,
  findRoleNameClash,
  modulesExist,
  createRole,
  updateRole,
  deleteRole,
  countRoleMembers,
  listRolesForAdmin,
} = vi.hoisted(() => ({
  requireAdminRequest: vi.fn(),
  enforceRateLimit: vi.fn(),
  recordAuditEvent: vi.fn(),
  findRole: vi.fn(),
  findRoleNameClash: vi.fn(),
  modulesExist: vi.fn(),
  createRole: vi.fn(),
  updateRole: vi.fn(),
  deleteRole: vi.fn(),
  countRoleMembers: vi.fn(),
  listRolesForAdmin: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({ prisma: {} }));
vi.mock('../lib/request-auth', () => ({ requireAdminRequest }));
vi.mock('../lib/rate-limit', () => ({ enforceRateLimit }));
vi.mock('../lib/audit', () => ({ recordAuditEvent }));
vi.mock('../lib/user', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/user')>()),
  countRoleMembers,
  listRolesForAdmin,
}));
vi.mock('../lib/roles', () => ({
  isAdminRoleName: (name: string) => name.trim().toLowerCase() === 'admin',
  findRole,
  findRoleNameClash,
  modulesExist,
  createRole,
  updateRole,
  deleteRole,
}));

import { DELETE, PUT } from '../app/api/admin/roles/[roleId]/route';
import { POST } from '../app/api/admin/roles/route';
import { bucketSignIns } from '../lib/admin-console';
import { isDormant, isNeverUsed } from '../lib/admin-rules';
import { buildAccessUser } from '../lib/user';
import { niceTop } from '../app/modules/reports/charts';
import { describeAction, describeEntityType, formatIp, generatePassword, isValidPassword } from '../app/admin/_components/admin-ui';

const json = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const params = (roleId: string) => ({ params: Promise.resolve({ roleId }) });

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminRequest.mockResolvedValue({ auth: { user: { id: 1 }, sessionId: 's1' }, response: null });
  enforceRateLimit.mockResolvedValue({ allowed: true });
  findRoleNameClash.mockResolvedValue(null);
  modulesExist.mockResolvedValue(true);
  listRolesForAdmin.mockResolvedValue([]);
});

describe('custom roles API', () => {
  it('creates a role with its modules and records it', async () => {
    createRole.mockResolvedValue({ id: 9, name: 'Finance' });
    const res = await POST(new NextRequest('http://x/api/admin/roles', json({ name: 'Finance', moduleIds: [3, 4] })));

    expect(res.status).toBe(201);
    expect(createRole).toHaveBeenCalledWith({ name: 'Finance', description: '', moduleIds: [3, 4] });
    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'admin.role.created' }));
  });

  it('refuses a name that already exists, ignoring case, and "admin"', async () => {
    findRoleNameClash.mockResolvedValueOnce({ id: 2, name: 'finance' });
    expect((await POST(new NextRequest('http://x', json({ name: 'Finance' })))).status).toBe(409);
    expect((await POST(new NextRequest('http://x', json({ name: 'ADMIN' })))).status).toBe(409);
    expect(createRole).not.toHaveBeenCalled();
  });

  it('rejects names with odd characters and unknown modules', async () => {
    expect((await POST(new NextRequest('http://x', json({ name: '<script>' })))).status).toBe(400);
    modulesExist.mockResolvedValueOnce(false);
    expect((await POST(new NextRequest('http://x', json({ name: 'Ops', moduleIds: [999] })))).status).toBe(400);
  });

  it('only lets the admin role change its description', async () => {
    findRole.mockResolvedValue({ id: 1, name: 'admin', description: '', roleModules: [] });
    const put = (body: unknown) => PUT(new NextRequest('http://x', { ...json(body), method: 'PUT' }), params('1'));

    expect((await put({ name: 'boss' })).status).toBe(400);
    expect((await put({ moduleIds: [1] })).status).toBe(400);
    expect((await put({ description: 'Runs the place' })).status).toBe(200);
    expect(updateRole).toHaveBeenCalledTimes(1);
  });

  it('records which modules a role gained and lost', async () => {
    findRole.mockResolvedValue({ id: 5, name: 'Ops', description: '', roleModules: [{ moduleId: 1 }, { moduleId: 2 }] });
    await PUT(new NextRequest('http://x', { ...json({ moduleIds: [2, 3] }), method: 'PUT' }), params('5'));

    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ modulesAdded: [3], modulesRemoved: [1] }) }),
    );
  });

  it('will not delete the admin role, or a role people still hold', async () => {
    findRole.mockResolvedValueOnce({ id: 1, name: 'admin', description: '', roleModules: [] });
    expect((await DELETE(new NextRequest('http://x', { method: 'DELETE' }), params('1'))).status).toBe(400);

    findRole.mockResolvedValueOnce({ id: 5, name: 'Ops', description: '', roleModules: [] });
    countRoleMembers.mockResolvedValueOnce(2);
    const res = await DELETE(new NextRequest('http://x', { method: 'DELETE' }), params('5'));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/2 people/);
    expect(deleteRole).not.toHaveBeenCalled();
  });

  it('is admin-only', async () => {
    requireAdminRequest.mockResolvedValueOnce({ auth: null, response: new Response(null, { status: 403 }) });
    expect((await POST(new NextRequest('http://x', json({ name: 'Ops' })))).status).toBe(403);
  });
});

describe('access from roles', () => {
  const mod = (id: number, slug: string) => ({
    id,
    slug,
    name: slug,
    description: '',
    category: 'X',
    sortOrder: id,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const role = (name: string, modules: ReturnType<typeof mod>[]) => ({
    role: {
      id: name.length,
      name,
      description: '',
      createdAt: new Date(),
      updatedAt: new Date(),
      rolePermissions: [],
      roleModules: modules.map((module, i) => ({ id: i, roleId: 1, moduleId: module.id, module })),
    },
  });

  it('gives a user every module of every role, plus their own, without duplicates', () => {
    const user = buildAccessUser({
      id: 7,
      email: 'a@b.c',
      name: 'A',
      passwordHash: '',
      status: 'active',
      sessionVersion: 1,
      dashboardHighlights: [],
      worldClockZones: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      userRoles: [role('Finance', [mod(3, 'invoices'), mod(1, 'reports')]), role('Ops', [mod(1, 'reports')])],
      userModules: [{ id: 1, userId: 7, moduleId: 9, assignedAt: new Date(), module: mod(9, 'feedback') }],
    } as unknown as Parameters<typeof buildAccessUser>[0]);

    expect(user.modules.map((m) => m.slug)).toEqual(['reports', 'invoices', 'feedback']);
  });
});

describe('overview rules', () => {
  const now = new Date('2026-10-15T12:00:00');

  it('buckets sign-ins per day, including empty days', () => {
    const daily = bucketSignIns(
      [
        { action: 'auth.login.succeeded', createdAt: new Date('2026-10-15T08:00:00') },
        { action: 'auth.login.failed', createdAt: new Date('2026-10-15T09:00:00') },
        { action: 'auth.login.succeeded', createdAt: new Date('2026-10-13T23:30:00') },
        { action: 'auth.login.succeeded', createdAt: new Date('2026-09-01T10:00:00') },
      ],
      now,
      3,
    );
    expect(daily).toEqual([
      { date: '2026-10-13', succeeded: 1, failed: 0 },
      { date: '2026-10-14', succeeded: 0, failed: 0 },
      { date: '2026-10-15', succeeded: 1, failed: 1 },
    ]);
  });

  it('flags accounts never used after a grace period, and dormant ones after 30 days', () => {
    expect(isNeverUsed('2026-10-14T00:00:00', null, now)).toBe(false);
    expect(isNeverUsed('2026-10-01T00:00:00', null, now)).toBe(true);
    expect(isNeverUsed('2026-10-01T00:00:00', '2026-10-02T00:00:00', now)).toBe(false);
    expect(isDormant('2026-09-01T00:00:00', now)).toBe(true);
    expect(isDormant('2026-10-01T00:00:00', now)).toBe(false);
    expect(isDormant(null, now)).toBe(false);
  });
});

describe('console helpers', () => {
  it('reads audit codes as sentences', () => {
    expect(describeAction('auth.login.failed')).toBe('Failed sign-in');
    expect(describeAction('invoice.pdf.downloaded')).toBe('Invoice PDF downloaded');
    expect(describeAction('ai.deal.create')).toBe('AI deal create');
    expect(describeAction('customer.created')).toBe('Client created');
  });

  it('shows stored customer entity types as clients', () => {
    expect(describeEntityType('Customer')).toBe('Client');
    expect(describeEntityType('customer')).toBe('client');
    expect(describeEntityType('trip')).toBe('trip');
  });

  it('shows plain addresses', () => {
    expect(formatIp('::ffff:10.0.0.5')).toBe('10.0.0.5');
    expect(formatIp('::1')).toBe('This computer (localhost)');
    expect(formatIp(null)).toBe('Unknown IP');
  });

  it('generates passwords that pass the password rules', () => {
    for (let i = 0; i < 200; i++) {
      const pw = generatePassword();
      expect(pw).toHaveLength(14);
      expect(isValidPassword(pw)).toBe(true);
    }
  });

  it('puts chart gridlines on round numbers', () => {
    expect(niceTop(26, true)).toBe(40);
    expect(niceTop(1, true)).toBe(4);
    expect(niceTop(9, true)).toBe(20);
    expect(niceTop(11_169_956)).toBe(20_000_000);
  });
});
