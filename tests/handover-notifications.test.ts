import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db, notifyNotificationsChanged, requireRequestAuth } = vi.hoisted(() => ({
  db: {
    shiftConfig: { findUnique: vi.fn() },
    shiftMonth: { findUnique: vi.fn() },
    shiftRecord: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    handoverEntry: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    handoverNotification: { createMany: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
  },
  notifyNotificationsChanged: vi.fn(),
  requireRequestAuth: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('../lib/notification-events', () => ({ notifyNotificationsChanged }));
vi.mock('../lib/request-auth', () => ({ requireRequestAuth }));

import { POST as acknowledge } from '../app/api/handover/[id]/acknowledge/route';
import { POST as createRoute } from '../app/api/handover/route';
import { handoverAudience, handoverMessage, markHandoverNotificationsRead, notifyIncomingShift } from '../lib/handover-notifications';
import { DEFAULT_RULES, incomingShift } from '../lib/shift-rules';
import type { AccessUser } from '../lib/user';

/** A moment on the Nairobi roster clock (UTC+3, no daylight saving). */
const at = (date: string, time: string) => Date.parse(`${date}T${time}:00+03:00`);

/** One roster line's record for a date. */
const record = (code: string, user: { id: number; name: string; status?: string } | null, extra: Record<string, unknown> = {}) => ({
  plannedCode: code,
  workedCode: null,
  status: 'planned',
  line: { sortOrder: 0, user: user ? { status: 'active', ...user } : null },
  ...extra,
});

const NIMMO = { id: 12, name: 'Nimmo' };
const KEVIN = { id: 14, name: 'Kevin' };

beforeEach(() => {
  for (const table of Object.values(db)) for (const fn of Object.values(table)) fn.mockReset();
  notifyNotificationsChanged.mockReset();
  requireRequestAuth.mockReset();
  // No saved config: the framework's Day 07:00, Swing 15:00, Night 23:00.
  db.shiftConfig.findUnique.mockResolvedValue(null);
  db.shiftMonth.findUnique.mockResolvedValue({ status: 'published' });
  db.shiftRecord.findMany.mockResolvedValue([]);
  db.user.findMany.mockResolvedValue([]);
  db.handoverNotification.createMany.mockResolvedValue({ count: 0 });
  db.handoverNotification.findMany.mockResolvedValue([]);
  db.handoverNotification.updateMany.mockResolvedValue({ count: 0 });
});

describe('the incoming shift', () => {
  const shift = (date: string, time: string) => {
    const found = incomingShift(DEFAULT_RULES, at(date, time));
    return found && `${found.name} ${found.date}`;
  };

  it('is the next shift to start', () => {
    expect(shift('2026-11-11', '14:50')).toBe('Swing 2026-11-11');
    expect(shift('2026-11-11', '22:30')).toBe('Night 2026-11-11');
    expect(shift('2026-11-11', '10:00')).toBe('Swing 2026-11-11');
  });

  it('is still the one that just came on, for a handover written after the change', () => {
    expect(shift('2026-11-11', '15:10')).toBe('Swing 2026-11-11');
    expect(shift('2026-11-11', '17:00')).toBe('Swing 2026-11-11');
    // Two hours in, the note is for whoever comes next.
    expect(shift('2026-11-11', '17:01')).toBe('Night 2026-11-11');
  });

  it('follows the night shift across midnight', () => {
    // Night came on at 23:00 yesterday; its handover is written just after midnight.
    expect(shift('2026-11-12', '00:30')).toBe('Night 2026-11-11');
    expect(shift('2026-11-12', '06:45')).toBe('Day 2026-11-12');
    expect(shift('2026-11-12', '08:00')).toBe('Day 2026-11-12');
  });

  it('has nothing to offer when no console shift has a start time', () => {
    const none = { ...DEFAULT_RULES, codes: { ...DEFAULT_RULES.codes, D: { ...DEFAULT_RULES.codes.D, start: null }, S: { ...DEFAULT_RULES.codes.S, start: null }, N: { ...DEFAULT_RULES.codes.N, start: null } } };
    expect(incomingShift(none, at('2026-11-11', '14:50'))).toBeNull();
  });
});

describe('who a handover reaches', () => {
  const audience = () => handoverAudience(1, at('2026-11-11', '14:50'));

  it('is whoever the roster has on the incoming shift', async () => {
    db.shiftRecord.findMany.mockResolvedValue([record('D', { id: 1, name: 'Writer' }), record('S', NIMMO), record('S', KEVIN), record('N', { id: 15, name: 'Night' })]);

    expect(await audience()).toMatchObject({ via: 'roster', shift: { name: 'Swing', date: '2026-11-11' }, recipients: [NIMMO, KEVIN] });
    expect(db.shiftRecord.findMany.mock.calls[0]![0].where).toMatchObject({ date: '2026-11-11' });
    expect(db.user.findMany).not.toHaveBeenCalled();
  });

  it('leaves out the writer, anyone absent, and anyone whose login is switched off', async () => {
    db.shiftRecord.findMany.mockResolvedValue([
      record('S', { id: 1, name: 'Writer' }),
      record('S', NIMMO, { status: 'sick' }),
      record('S', { ...KEVIN, status: 'disabled' }),
      record('S', { id: 16, name: 'Aisha' }),
    ]);
    expect((await audience()).recipients).toEqual([{ id: 16, name: 'Aisha' }]);
  });

  it('counts someone called in to cover the shift, and not the shift they were planned on', async () => {
    db.shiftRecord.findMany.mockResolvedValue([record('OC', NIMMO, { workedCode: 'S', status: 'call-in' }), record('S', KEVIN, { workedCode: 'N', status: 'swapped' })]);
    expect((await audience()).recipients).toEqual([NIMMO]);
  });

  it('falls back to everyone with Handover access when the roster reaches no one', async () => {
    // Rostered, but the line has no login.
    db.shiftRecord.findMany.mockResolvedValue([record('S', null)]);
    db.user.findMany.mockResolvedValue([KEVIN, NIMMO]);

    expect(await audience()).toMatchObject({ via: 'access', shift: { name: 'Swing' }, recipients: [KEVIN, NIMMO] });
    const where = db.user.findMany.mock.calls[0]![0].where;
    expect(where).toMatchObject({ status: 'active', id: { not: 1 } });
    // Their own grant, a role's, or admin.
    expect(JSON.stringify(where.OR)).toContain('"slug":"handover"');
    expect(JSON.stringify(where.OR)).toContain('"name":"admin"');
  });

  it('does not trust a month that is still a draft', async () => {
    db.shiftMonth.findUnique.mockResolvedValue({ status: 'draft' });
    db.shiftRecord.findMany.mockResolvedValue([record('S', NIMMO)]);
    db.user.findMany.mockResolvedValue([KEVIN]);

    expect(await audience()).toMatchObject({ via: 'access', recipients: [KEVIN] });
    expect(db.shiftRecord.findMany).not.toHaveBeenCalled();
  });

  it('says so when there is nobody else to tell', async () => {
    expect(await audience()).toMatchObject({ via: 'none', recipients: [] });
  });
});

describe('announcing a handover', () => {
  const handover = { id: 31, shiftPeriod: 'Day', status: 'Normal', summary: '**All quiet.**\n- Gate 2 camera is back' };

  it('puts it in each recipient\'s bell and nudges their open tabs', async () => {
    db.shiftRecord.findMany.mockResolvedValue([record('S', NIMMO), record('S', KEVIN)]);

    const told = await notifyIncomingShift({ handover, writer: { id: 1, name: 'Reagan' }, nowMs: at('2026-11-11', '14:50') });

    expect(told).toEqual({ via: 'roster', shiftName: 'Swing', names: ['Nimmo', 'Kevin'] });
    const { data } = db.handoverNotification.createMany.mock.calls[0]![0];
    expect(data.map((row: { userId: number }) => row.userId)).toEqual([12, 14]);
    expect(data[0]).toMatchObject({ handoverId: 31, type: 'handover.new' });
    expect(data[0].message).toMatch(/^Reagan handed over the Day shift: /);
    // Plain words in the bell, not the editor's markup.
    expect(data[0].message).not.toContain('**');
    expect(notifyNotificationsChanged).toHaveBeenCalledWith([12, 14]);
  });

  it('leads with the status when the handover is flagged', () => {
    expect(handoverMessage({ ...handover, status: 'Urgent' }, 'Reagan')).toMatch(/^Urgent: Reagan handed over the Day shift: /);
    expect(handoverMessage({ ...handover, summary: 'x'.repeat(400) }, 'Reagan').length).toBeLessThan(200);
  });

  it('writes nothing when there is nobody to tell, and never fails the save', async () => {
    expect(await notifyIncomingShift({ handover, writer: { id: 1, name: 'Reagan' } })).toMatchObject({ via: 'none', names: [] });
    expect(db.handoverNotification.createMany).not.toHaveBeenCalled();

    db.shiftRecord.findMany.mockRejectedValue(new Error('database is down'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await notifyIncomingShift({ handover, writer: { id: 1, name: 'Reagan' } })).toEqual({ via: 'none', shiftName: null, names: [] });
    errors.mockRestore();
  });

  it('marks only the caller\'s own notifications read', async () => {
    db.handoverNotification.updateMany.mockResolvedValue({ count: 1 });
    expect(await markHandoverNotificationsRead(12, [5, 5, -1, 2.5])).toBe(1);
    expect(db.handoverNotification.updateMany.mock.calls[0]![0].where).toEqual({ userId: 12, id: { in: [5] }, readAt: null });
    expect(notifyNotificationsChanged).toHaveBeenCalledWith(12);
  });
});

describe('the handover routes', () => {
  const user = (id: number, name: string): AccessUser => ({
    id, name, email: `${name}@example.test`, status: 'active', createdAt: '', updatedAt: '', sessionVersion: 1,
    roles: [], permissions: [],
    modules: [{ id: 1, slug: 'handover', name: 'Handover', description: '', category: 'Operations', sortOrder: 0 }],
  });
  const row = (extra: Record<string, unknown> = {}) => ({
    id: 31, shiftDate: new Date('2026-11-11T00:00:00Z'), shiftPeriod: 'Day', post: null, status: 'Normal', summary: 'All quiet.',
    incidents: null, watchItems: null, createdAt: new Date('2026-11-11T11:50:00Z'), acknowledgedAt: null,
    createdBy: { id: 1, name: 'Reagan' }, acknowledgedBy: null, ...extra,
  });

  it('tell the writer who was notified when a handover is saved', async () => {
    requireRequestAuth.mockResolvedValue({ auth: { user: user(1, 'Reagan') }, response: null });
    db.handoverEntry.create.mockResolvedValue(row());
    db.user.findMany.mockResolvedValue([NIMMO]);

    const response = await createRoute(new NextRequest('http://x/api/handover', { method: 'POST', body: JSON.stringify({ summary: 'All quiet.' }) }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.item.id).toBe(31);
    expect(body.notified).toMatchObject({ via: 'access', names: ['Nimmo'] });
    expect(db.handoverNotification.createMany.mock.calls[0]![0].data).toEqual([expect.objectContaining({ userId: 12, handoverId: 31 })]);
  });

  it('clear it from every bell once someone acknowledges it', async () => {
    requireRequestAuth.mockResolvedValue({ auth: { user: user(12, 'Nimmo') }, response: null });
    db.handoverEntry.findUnique.mockResolvedValue({ id: 31, createdById: 1, acknowledgedById: null });
    db.handoverEntry.update.mockResolvedValue(row({ acknowledgedBy: NIMMO, acknowledgedAt: new Date('2026-11-11T12:05:00Z') }));
    db.handoverNotification.findMany.mockResolvedValue([{ userId: 12 }, { userId: 14 }]);

    const response = await acknowledge(new NextRequest('http://x/api/handover/31/acknowledge', { method: 'POST' }), { params: Promise.resolve({ id: '31' }) });

    expect(response.status).toBe(200);
    expect(db.handoverNotification.updateMany.mock.calls[0]![0].where).toEqual({ handoverId: 31, readAt: null });
    expect(notifyNotificationsChanged).toHaveBeenCalledWith([12, 14]);
  });
});
