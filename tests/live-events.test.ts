import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { publishAll } = vi.hoisted(() => ({ publishAll: vi.fn() }));
vi.mock('../lib/chat-bus', () => ({ publishAll }));

import { announceWrite, isWriteOperation, markRequest, tableOfRawWrite } from '../lib/live-events';
import { MODULE_SOURCES, matchesSource, sourcesForPath, touches, touchesAccess } from '../lib/live-sources';
import { DEFAULT_MODULES } from '../lib/module-catalog';

/** The models named by the events sent so far. */
const sent = () => publishAll.mock.calls.map(([event, data]) => ({ event, models: (data as { models: string[] }).models }));

/** Runs `work` the way a route handler does: the session lookup marks the request first. */
async function duringRequest(method: string, work: () => void) {
  const gate = async () => {
    markRequest(method);
    await Promise.resolve();
  };
  await gate();
  work();
}

describe('announcing writes', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    publishAll.mockReset();
  });
  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
  });

  it('folds the writes of one save into a single event naming each model once', async () => {
    await duringRequest('POST', () => {
      announceWrite('Trip');
      announceWrite('TripItineraryItem');
      announceWrite('Trip');
    });
    expect(publishAll).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(sent()).toEqual([{ event: 'changed', models: ['Trip', 'TripItineraryItem'] }]);
  });

  it('still gets through at least once a second under a steady stream of writes', async () => {
    await duringRequest('POST', () => undefined);
    for (let i = 0; i < 30; i += 1) {
      announceWrite('Vehicle');
      vi.advanceTimersByTime(100);
    }
    expect(publishAll.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('says nothing about bookkeeping and chat traffic', async () => {
    await duringRequest('POST', () => {
      for (const model of ['Session', 'AuditLog', 'RateLimitBucket', 'MessagingMessage', 'WhatsAppMessage', 'QuoteSequence']) {
        announceWrite(model);
      }
      announceWrite(undefined);
    });
    vi.advanceTimersByTime(2_000);
    expect(publishAll).not.toHaveBeenCalled();
  });

  it('says nothing for a bulk write that matched no rows', async () => {
    await duringRequest('POST', () => announceWrite('Note', { count: 0 }));
    vi.advanceTimersByTime(2_000);
    expect(publishAll).not.toHaveBeenCalled();

    await duringRequest('POST', () => announceWrite('Note', { count: 3 }));
    vi.advanceTimersByTime(300);
    expect(sent()).toEqual([{ event: 'changed', models: ['Note'] }]);
  });

  it('keeps a read quiet, so a page that writes while loading cannot refresh itself in a loop', async () => {
    await duringRequest('GET', () => announceWrite('BulletinRead'));
    vi.advanceTimersByTime(2_000);
    expect(publishAll).not.toHaveBeenCalled();
  });

  it('lets an old mark expire, so a job started from a request is not silenced for good', async () => {
    await duringRequest('GET', () => undefined);
    vi.advanceTimersByTime(61_000);
    announceWrite('ZelloActivity');
    vi.advanceTimersByTime(300);
    expect(sent()).toEqual([{ event: 'changed', models: ['ZelloActivity'] }]);
  });

  it('never throws, even when the bus does', async () => {
    publishAll.mockImplementation(() => {
      throw new Error('stream closed');
    });
    await duringRequest('POST', () => announceWrite('Trip'));
    expect(() => vi.advanceTimersByTime(300)).not.toThrow();
  });
});

describe('reading a write off its shape', () => {
  it('knows which operations change rows', () => {
    for (const op of ['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']) expect(isWriteOperation(op), op).toBe(true);
    for (const op of ['findMany', 'findUnique', 'count', 'aggregate', 'groupBy']) expect(isWriteOperation(op), op).toBe(false);
  });

  it('finds the table in raw SQL', () => {
    expect(tableOfRawWrite([{ strings: ['INSERT INTO "PersonalTodoComment" ("todoId") VALUES (', ')'] }])).toBe('PersonalTodoComment');
    expect(tableOfRawWrite([{ strings: ['UPDATE "public"."PersonalTodoNotification" SET "readAt" = now() WHERE "userId" = ', ''] }])).toBe('PersonalTodoNotification');
    expect(tableOfRawWrite(['DELETE FROM "PersonalTodoShare" WHERE "todoId" = $1', 4])).toBe('PersonalTodoShare');
    expect(tableOfRawWrite([{ strings: ['SELECT 1'] }])).toBeUndefined();
  });
});

describe('which screen cares about which change', () => {
  it('matches by prefix, and by suffix when starred', () => {
    expect(matchesSource('TripItineraryItem', ['Trip'])).toBe(true);
    expect(matchesSource('Traveler', ['Trip'])).toBe(false);
    expect(matchesSource('QuoteNotification', ['*Notification'])).toBe(true);
  });

  it('refreshes a trip screen for a trip change and not for a note', () => {
    const sources = sourcesForPath('/modules/trip-planning/42');
    expect(touches(['TripAssignment'], sources)).toBe(true);
    expect(touches(['Note'], sources)).toBe(false);
  });

  it('leaves clocks and chat alone, and refreshes an unlisted screen on anything', () => {
    expect(touches(['Trip', 'Note'], sourcesForPath('/modules/clock'))).toBe(false);
    expect(touches(['Conversation'], sourcesForPath('/modules/communication'))).toBe(false);
    expect(sourcesForPath('/modules/something-new')).toBeNull();
    expect(touches(['Note'], null)).toBe(true);
  });

  it('treats an access change as everyone\'s business', () => {
    expect(touchesAccess(['UserModule'])).toBe(true);
    expect(touchesAccess(['Trip'])).toBe(false);
  });

  it('only lists real modules', () => {
    const slugs = new Set(DEFAULT_MODULES.map((m) => m.slug));
    expect(Object.keys(MODULE_SOURCES).filter((slug) => !slugs.has(slug))).toEqual([]);
  });
});
