import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db } = vi.hoisted(() => ({
  db: {
    contact: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    customer: { findMany: vi.fn(), findUnique: vi.fn() },
    crmActivity: { findMany: vi.fn(), create: vi.fn() },
  },
}));

vi.mock('server-only', () => ({}));
vi.mock('../lib/prisma', () => ({ prisma: db }));

import {
  contactVisibleTo,
  deleteContact,
  getContactPhoto,
  isContactVisibleTo,
  listContacts,
  setContactPhoto,
  updateContact,
} from '../lib/contacts';
import { createActivity, listCrmActivities, listCrmCustomers } from '../lib/crm';
import { upsertGoogleContacts } from '../lib/google-contacts';

const ME = 1;
const SOMEONE_ELSE = 12;

/** The rule every query carries: the shared directory, plus this person's own Google contacts. */
const MINE = { OR: [{ source: { not: 'google' } }, { createdById: ME }] };

const row = (extra: Record<string, unknown> = {}) => ({
  id: 5,
  name: 'Grace Mwaura',
  role: null,
  category: 'Client',
  email: null,
  phone: null,
  location: null,
  notes: null,
  tags: [],
  photoName: null,
  source: 'manual',
  createdAt: new Date('2026-11-11T00:00:00Z'),
  customer: null,
  ...extra,
});

beforeEach(() => {
  for (const table of Object.values(db)) for (const fn of Object.values(table)) fn.mockReset();
});

describe('who may see a contact', () => {
  it('is everyone for the shared directory, and only its owner for a Google contact', () => {
    expect(contactVisibleTo(ME)).toEqual(MINE);

    expect(isContactVisibleTo({ source: 'manual', createdById: SOMEONE_ELSE }, ME)).toBe(true);
    expect(isContactVisibleTo({ source: 'google', createdById: ME }, ME)).toBe(true);
    expect(isContactVisibleTo({ source: 'google', createdById: SOMEONE_ELSE }, ME)).toBe(false);
  });

  it('lists the directory through that rule, and marks the viewer\'s own synced contacts', async () => {
    db.contact.findMany.mockResolvedValue([row(), row({ id: 6, source: 'google', tags: ['google'] })]);

    const contacts = await listContacts(ME);

    expect(db.contact.findMany.mock.calls[0]![0].where).toEqual(MINE);
    expect(contacts.map((c) => [c.id, c.private])).toEqual([
      [5, false],
      [6, true],
    ]);
  });
});

describe('someone else\'s Google contact', () => {
  // The database finds nothing for this viewer, as it would for a contact that isn't there.
  beforeEach(() => db.contact.findFirst.mockResolvedValue(null));

  it('cannot be edited, deleted, or have its photo read or replaced', async () => {
    expect(await updateContact(5, { name: 'Changed' }, ME)).toBeNull();
    expect(await deleteContact(5, ME)).toBe(false);
    expect(await getContactPhoto(5, ME)).toBeNull();
    expect(await setContactPhoto(5, { name: 'a.png', mime: 'image/png', size: 1, content: Buffer.from('x') }, ME)).toBe(false);

    expect(db.contact.update).not.toHaveBeenCalled();
    expect(db.contact.delete).not.toHaveBeenCalled();
    for (const [args] of db.contact.findFirst.mock.calls) {
      expect(args.where).toMatchObject({ id: 5, ...MINE });
    }
  });

  it('cannot have a CRM activity logged against it', async () => {
    db.customer.findUnique.mockResolvedValue({ id: 3 });

    expect(await createActivity(ME, { customerId: 3, contactId: 5, type: 'call', summary: 'Rang them' })).toEqual({ error: 'Contact not found' });
    expect(db.crmActivity.create).not.toHaveBeenCalled();
    expect(db.contact.findFirst.mock.calls[0]![0].where).toMatchObject({ id: 5, ...MINE });
  });
});

describe('the CRM', () => {
  it('lists each client\'s contacts through the same rule', async () => {
    db.customer.findMany.mockResolvedValue([]);
    await listCrmCustomers(ME);
    expect(db.customer.findMany.mock.calls[0]![0].include.contacts.where).toEqual(MINE);
  });

  it('keeps an activity but does not name a contact the viewer may not see', async () => {
    const activity = (id: number, contact: unknown) => ({
      id, customerId: 3, dealId: null, contactId: 5, type: 'call', summary: 'Rang them',
      occurredAt: new Date('2026-11-11T09:00:00Z'), createdBy: { name: 'Nimmo' }, contact,
    });
    db.crmActivity.findMany.mockResolvedValue([
      activity(1, { name: 'Shared Contact', source: 'manual', createdById: SOMEONE_ELSE }),
      activity(2, { name: 'My Google Contact', source: 'google', createdById: ME }),
      activity(3, { name: 'Their Google Contact', source: 'google', createdById: SOMEONE_ELSE }),
    ]);

    const activities = await listCrmActivities(ME);

    expect(activities.map((a) => [a.id, a.contactName, a.contactId])).toEqual([
      [1, 'Shared Contact', 5],
      [2, 'My Google Contact', 5],
      [3, null, null],
    ]);
    expect(activities[2]!.summary).toBe('Rang them');
  });
});

describe('syncing Google contacts', () => {
  const grace = { resourceName: 'people/c1', name: 'Grace Mwaura', email: 'grace@example.test', phone: null, role: null, location: null, notes: null };

  it('only ever matches the syncing user\'s own earlier imports', async () => {
    db.contact.findMany.mockResolvedValue([]);

    expect(await upsertGoogleContacts(ME, [grace])).toMatchObject({ created: 1, updated: 0 });

    // Someone else who synced the same Google account keeps their copy untouched.
    expect(db.contact.findMany.mock.calls[0]![0].where).toEqual({ createdById: ME, googleResourceName: { in: ['people/c1'] } });
    expect(db.contact.create.mock.calls[0]![0].data).toMatchObject({ source: 'google', googleResourceName: 'people/c1', createdById: ME });
    expect(db.contact.update).not.toHaveBeenCalled();
  });

  it('refreshes the user\'s own copy on a second sync instead of adding another', async () => {
    db.contact.findMany.mockResolvedValue([{ id: 6, googleResourceName: 'people/c1', notes: 'Met at the summit' }]);

    expect(await upsertGoogleContacts(ME, [{ ...grace, name: 'Grace M. Mwaura', notes: 'From Google' }])).toMatchObject({ created: 0, updated: 1 });

    expect(db.contact.create).not.toHaveBeenCalled();
    expect(db.contact.update.mock.calls[0]![0]).toMatchObject({ where: { id: 6 }, data: { name: 'Grace M. Mwaura', notes: 'Met at the summit' } });
  });
});
