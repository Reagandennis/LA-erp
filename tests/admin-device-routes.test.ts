import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  approveDevice: vi.fn(),
  countApprovedDevices: vi.fn(),
  deleteDevice: vi.fn(),
  enforceRateLimit: vi.fn(),
  getDevice: vi.fn(),
  getWebAuthnConfig: vi.fn(),
  listDevices: vi.fn(),
  recordAuditEvent: vi.fn(),
  requireAdminRequest: vi.fn(),
  revokeDevice: vi.fn(),
  setDeviceRequirement: vi.fn(),
  userFindUnique: vi.fn(),
}));

vi.mock('../lib/audit', () => ({ recordAuditEvent: mocks.recordAuditEvent }));
vi.mock('../lib/prisma', () => ({ prisma: { user: { findUnique: mocks.userFindUnique } } }));
vi.mock('../lib/rate-limit', () => ({ enforceRateLimit: mocks.enforceRateLimit }));
vi.mock('../lib/request-auth', () => ({ requireAdminRequest: mocks.requireAdminRequest }));
vi.mock('../lib/work-devices', () => ({
  approveDevice: mocks.approveDevice,
  countApprovedDevices: mocks.countApprovedDevices,
  deleteDevice: mocks.deleteDevice,
  getDevice: mocks.getDevice,
  getWebAuthnConfig: mocks.getWebAuthnConfig,
  listDevices: mocks.listDevices,
  revokeDevice: mocks.revokeDevice,
  setDeviceRequirement: mocks.setDeviceRequirement,
}));

import { PUT as setPolicy } from '../app/api/admin/devices/policy/route';
import { DELETE as removeDevice, PATCH as changeDevice } from '../app/api/admin/devices/route';

const ADMIN_ID = 1;

const send = (handler: (r: NextRequest) => Promise<Response | null>, method: string, path: string, body?: unknown) =>
  handler(
    new NextRequest(`http://localhost${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  ) as Promise<Response>;

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.requireAdminRequest.mockResolvedValue({ auth: { user: { id: ADMIN_ID }, deviceId: 'dev_mine' }, response: null });
  mocks.enforceRateLimit.mockResolvedValue({ allowed: true });
  mocks.getWebAuthnConfig.mockReturnValue({ rpID: 'erp.example.com', origin: 'https://erp.example.com' });
  mocks.userFindUnique.mockResolvedValue({ id: 5 });
  mocks.setDeviceRequirement.mockResolvedValue(1);
  mocks.listDevices.mockResolvedValue([]);
});

describe('who must use an approved device', () => {
  it('requires it for another person', async () => {
    mocks.countApprovedDevices.mockResolvedValue(0);
    const response = await send(setPolicy, 'PUT', '/api/admin/devices/policy', { required: true, userId: 5 });

    expect(response.status).toBe(200);
    expect(mocks.setDeviceRequirement).toHaveBeenCalledWith({ required: true, userIds: [5], exceptUserId: undefined });
  });

  it('will not let an admin lock themselves out', async () => {
    mocks.countApprovedDevices.mockResolvedValue(0);
    const response = await send(setPolicy, 'PUT', '/api/admin/devices/policy', { required: true, userId: ADMIN_ID });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('locked out');
    expect(mocks.setDeviceRequirement).not.toHaveBeenCalled();
  });

  it('lets an admin with an approved device require it for themselves', async () => {
    mocks.countApprovedDevices.mockResolvedValue(1);
    const response = await send(setPolicy, 'PUT', '/api/admin/devices/policy', { required: true, userId: ADMIN_ID });

    expect(response.status).toBe(200);
    expect(mocks.setDeviceRequirement).toHaveBeenCalledWith({ required: true, userIds: [ADMIN_ID], exceptUserId: undefined });
  });

  it('leaves the admin out of "everyone" when they have no approved device, and says so', async () => {
    mocks.countApprovedDevices.mockResolvedValue(0);
    mocks.setDeviceRequirement.mockResolvedValue(12);
    const response = await send(setPolicy, 'PUT', '/api/admin/devices/policy', { required: true, everyone: true });

    expect(await response.json()).toMatchObject({ updated: 12, skippedSelf: true });
    expect(mocks.setDeviceRequirement).toHaveBeenCalledWith({ required: true, userIds: undefined, exceptUserId: ADMIN_ID });
  });

  it('always lets the rule be switched off, for anyone', async () => {
    mocks.countApprovedDevices.mockResolvedValue(0);
    mocks.getWebAuthnConfig.mockReturnValue(null);
    const response = await send(setPolicy, 'PUT', '/api/admin/devices/policy', { required: false, everyone: true });

    expect(await response.json()).toMatchObject({ skippedSelf: false });
    expect(mocks.setDeviceRequirement).toHaveBeenCalledWith({ required: false, userIds: undefined, exceptUserId: undefined });
  });

  it('refuses to switch the rule on before the site address is configured', async () => {
    mocks.getWebAuthnConfig.mockReturnValue(null);
    const response = await send(setPolicy, 'PUT', '/api/admin/devices/policy', { required: true, userId: 5 });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('WEBAUTHN_ORIGIN');
    expect(mocks.setDeviceRequirement).not.toHaveBeenCalled();
  });

  it('is for admins only', async () => {
    mocks.requireAdminRequest.mockResolvedValue({ auth: null, response: Response.json({ error: 'Forbidden' }, { status: 403 }) });
    const response = await send(setPolicy, 'PUT', '/api/admin/devices/policy', { required: true, everyone: true });

    expect(response.status).toBe(403);
    expect(mocks.setDeviceRequirement).not.toHaveBeenCalled();
  });
});

describe('approving and revoking devices', () => {
  const theirs = { id: 'dev_theirs', userId: 5, label: 'Front office laptop', status: 'pending' };

  it('approves a pending device and records who did it', async () => {
    mocks.getDevice.mockResolvedValue(theirs);
    const response = await send(changeDevice, 'PATCH', '/api/admin/devices', { id: 'dev_theirs', action: 'approve' });

    expect(response.status).toBe(200);
    expect(mocks.approveDevice).toHaveBeenCalledWith('dev_theirs', ADMIN_ID);
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'admin.device.approved', actorUserId: ADMIN_ID, targetUserId: 5 }),
    );
  });

  it('revokes a device', async () => {
    mocks.getDevice.mockResolvedValue({ ...theirs, status: 'approved' });
    const response = await send(changeDevice, 'PATCH', '/api/admin/devices', { id: 'dev_theirs', action: 'revoke' });

    expect(response.status).toBe(200);
    expect(mocks.revokeDevice).toHaveBeenCalledWith('dev_theirs');
  });

  it('will not revoke or remove the device the admin is signed in on', async () => {
    mocks.getDevice.mockResolvedValue({ id: 'dev_mine', userId: ADMIN_ID, label: 'My laptop', status: 'approved' });

    const revoked = await send(changeDevice, 'PATCH', '/api/admin/devices', { id: 'dev_mine', action: 'revoke' });
    const removed = await send(removeDevice, 'DELETE', '/api/admin/devices?id=dev_mine');

    expect(revoked.status).toBe(400);
    expect(removed.status).toBe(400);
    expect(mocks.revokeDevice).not.toHaveBeenCalled();
    expect(mocks.deleteDevice).not.toHaveBeenCalled();
  });

  it('is for admins only', async () => {
    mocks.requireAdminRequest.mockResolvedValue({ auth: null, response: Response.json({ error: 'Forbidden' }, { status: 403 }) });
    const response = await send(changeDevice, 'PATCH', '/api/admin/devices', { id: 'dev_theirs', action: 'approve' });

    expect(response.status).toBe(403);
    expect(mocks.approveDevice).not.toHaveBeenCalled();
  });
});
