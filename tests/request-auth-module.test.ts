import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

/**
 * Module access with the real `requireModuleRequest` — only "who is signed
 * in" is faked — exercised through routes that used to check sign-in alone.
 */

const { getRequestAuth } = vi.hoisted(() => ({ getRequestAuth: vi.fn() }));
vi.mock('../lib/auth', () => ({ getRequestAuth }));

vi.mock('../lib/contracts', () => ({
  listContracts: vi.fn().mockResolvedValue([{ id: 1, reference: 'CTR-1' }]),
  computeStats: vi.fn().mockReturnValue({ total: 1 }),
  createContract: vi.fn(),
}));
vi.mock('../lib/contacts', () => ({
  listContacts: vi.fn().mockResolvedValue([{ id: 3, name: 'Rose' }]),
  listCustomerOptions: vi.fn().mockResolvedValue([]),
  createContact: vi.fn(),
}));
vi.mock('../lib/upload-limits', () => ({ getUploadLimitMb: vi.fn(), mbToBytes: (mb: number) => mb * 1024 * 1024 }));

import { GET as contactsGET } from '../app/api/contacts/route';
import { GET as contractsGET } from '../app/api/contracts/route';
import { requireModuleRequest } from '../lib/request-auth';

function signedInAs(modules: string[], admin = false) {
  getRequestAuth.mockResolvedValue({
    user: {
      id: 9,
      roles: admin ? [{ id: 1, name: 'admin', description: '' }] : [{ id: 3, name: 'viewer', description: '' }],
      modules: modules.map((slug, i) => ({ id: i + 1, slug, name: slug, description: '', category: 'X', sortOrder: i })),
    },
  });
}

const request = (path: string) => new NextRequest(`http://localhost${path}`);

describe('requireModuleRequest', () => {
  beforeEach(() => getRequestAuth.mockReset());

  it('refuses anyone not signed in', async () => {
    getRequestAuth.mockResolvedValue(null);
    expect((await requireModuleRequest(request('/x'), 'intel')).response?.status).toBe(401);
  });

  it('lets in holders of any listed module, and admins; refuses everyone else', async () => {
    signedInAs(['contact-list']);
    expect((await requireModuleRequest(request('/x'), 'customers', 'contact-list')).response).toBeNull();
    signedInAs([], true);
    expect((await requireModuleRequest(request('/x'), 'intel')).response).toBeNull();
    signedInAs(['notes']);
    expect((await requireModuleRequest(request('/x'), 'intel')).response?.status).toBe(403);
  });
});

describe('routes that used to check sign-in only', () => {
  beforeEach(() => getRequestAuth.mockReset());

  it('contracts: a signed-in user without Contract Renewal is refused', async () => {
    signedInAs(['notes', 'calendar']);
    const refused = await contractsGET(request('/api/contracts'));
    expect(refused.status).toBe(403);

    signedInAs(['contract-renewal']);
    const allowed = await contractsGET(request('/api/contracts'));
    expect(allowed.status).toBe(200);
  });

  it('contacts: open to the Contacts module and to the CRM, which manages customer contacts', async () => {
    signedInAs(['customers']);
    expect((await contactsGET(request('/api/contacts'))).status).toBe(200);
    signedInAs(['contact-list']);
    expect((await contactsGET(request('/api/contacts'))).status).toBe(200);
    signedInAs(['quotes']);
    expect((await contactsGET(request('/api/contacts'))).status).toBe(403);
  });
});
