import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

/** Every delegate the searchers use, each with a findMany spy. */
const DELEGATES = [
  'trip', 'personalTodo', 'quote', 'invoice', 'customer', 'contact', 'personnel', 'traveler', 'vehicle',
  'contract', 'sop', 'note', 'storedFile', 'handoverEntry', 'intelAssessment', 'product', 'driverLicense',
  'calendarEvent', 'messagingAccount', 'messagingChat', 'messagingMessage',
] as const;
const { db } = vi.hoisted(() => ({ db: {} as Record<string, { findMany: ReturnType<typeof vi.fn> }> }));
vi.mock('../lib/prisma', () => ({ prisma: db }));

import { searchEverything } from '../lib/search';

type Slugs = string[];
const user = (modules: Slugs, admin = false) =>
  ({ id: 42, roles: admin ? [{ name: 'admin' }] : [], modules: modules.map((slug) => ({ slug })) }) as never;

const called = () => DELEGATES.filter((d) => db[d].findMany.mock.calls.length > 0);

beforeEach(() => {
  for (const name of DELEGATES) db[name] = { findMany: vi.fn().mockResolvedValue([]) };
});

describe('global search', () => {
  it('searches only the modules the person can use', async () => {
    await searchEverything(user(['customers', 'sops']), 'acme');
    expect(called().sort()).toEqual(['customer', 'sop']);
  });

  it('does nothing for a query under two characters', async () => {
    expect(await searchEverything(user([], true), 'a')).toEqual([]);
    expect(called()).toEqual([]);
  });

  it('limits people to the roles whose modules the person has, linking to that module', async () => {
    db.personnel.findMany.mockResolvedValue([{ id: 8, name: 'Mercy Achieng', email: null, role: 'Driver', roles: ['Driver', 'CPO'], department: null, callSign: null, phone: null }]);
    const groups = await searchEverything(user(['drivers']), 'mercy');

    expect(db.personnel.findMany.mock.calls[0]![0].where.roles).toEqual({ hasSome: ['Driver'] });
    expect(groups[0]!.hits[0]!.href).toBe('/modules/drivers?person=8');
  });

  it('applies the trip owner rule for everyone but admins', async () => {
    await searchEverything(user(['trip-planning']), 'TR-');
    expect(db.trip.findMany.mock.calls[0]![0].where.AND[0]).toEqual({ OR: [{ createdById: 42 }, { ownerId: 42 }] });

    db.trip.findMany.mockClear();
    await searchEverything(user([], true), 'TR-');
    expect(db.trip.findMany.mock.calls[0]![0].where.AND[0]).toEqual({});
  });

  it("never reaches into anyone else's chats — not even for an admin", async () => {
    await searchEverything(user([], true), 'invoice');
    for (const call of db.messagingAccount.findMany.mock.calls) {
      expect(call[0].where.userId).toBe(42);
    }
    // No linked accounts of their own: chats and messages aren't queried at all.
    expect(db.messagingChat.findMany).not.toHaveBeenCalled();
    expect(db.messagingMessage.findMany).not.toHaveBeenCalled();
  });

  it('keeps notes, calendar entries and tasks to their owner (tasks: or shared with them)', async () => {
    await searchEverything(user(['notes', 'calendar', 'todo-personal']), 'plan');
    expect(db.note.findMany.mock.calls[0]![0].where.userId).toBe(42);
    expect(db.calendarEvent.findMany.mock.calls[0]![0].where.userId).toBe(42);
    expect(db.personalTodo.findMany.mock.calls[0]![0].where.OR).toEqual([{ userId: 42 }, { shares: { some: { userId: 42 } } }]);
  });

  it('never loads stored files, photos or documents, nor passport and medical details', async () => {
    await searchEverything(user([], true), 'report');
    for (const name of DELEGATES) {
      for (const call of db[name].findMany.mock.calls) {
        const select = call[0]?.select ?? {};
        // Every query names its fields, so nothing heavy or sensitive comes along by default.
        expect(Object.keys(select).length).toBeGreaterThan(0);
        expect(Object.keys(select)).not.toEqual(expect.arrayContaining(['photoContent']));
        expect(JSON.stringify(select)).not.toMatch(/photoContent|documentContent|passportNumber|medicalNotes|mapImage/);
      }
    }
    // A stored file's bytes live in `content`; search must never pull them.
    expect(db.storedFile.findMany.mock.calls[0]![0].select).not.toHaveProperty('content');
  });

  it('for short queries, matches the start of a word only — "ali" finds Ali, not "Finalise"', async () => {
    db.customer.findMany.mockResolvedValue([
      { id: 1, name: 'Finalise Logistics', company: null, email: null, phone: null },
      { id: 2, name: 'Ali Traders', company: null, email: null, phone: null },
      { id: 3, name: 'The Ali Group', company: null, email: null, phone: null },
    ]);
    const [customers] = await searchEverything(user(['customers']), 'ali');
    expect(customers!.hits.map((h) => h.title)).toEqual(['Ali Traders', 'The Ali Group']);

    // Longer queries match anywhere, prefix matches first.
    db.customer.findMany.mockResolvedValue([
      { id: 1, name: 'Hospitality Partners', company: null, email: null, phone: null },
      { id: 4, name: 'Pitalia Ltd', company: null, email: null, phone: null },
    ]);
    const [again] = await searchEverything(user(['customers']), 'pital');
    expect(again!.hits.map((h) => h.title)).toEqual(['Pitalia Ltd', 'Hospitality Partners']);
  });

  it('carries on when one source fails', async () => {
    db.customer.findMany.mockRejectedValue(new Error('boom'));
    db.sop.findMany.mockResolvedValue([{ id: 3, code: 'SOP-7', title: 'Convoy briefing', category: 'Ops', status: 'Active', version: '2', description: null }]);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const groups = await searchEverything(user(['customers', 'sops']), 'convoy');
    spy.mockRestore();
    expect(groups.map((g) => g.id)).toEqual(['sops']);
    expect(groups[0]!.hits[0]).toMatchObject({ title: 'Convoy briefing', href: '/modules/sops?open=3' });
  });
});
