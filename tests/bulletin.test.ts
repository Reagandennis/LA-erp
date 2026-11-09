import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  bulletinPost: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  bulletinRead: { findMany: vi.fn(), upsert: vi.fn() },
}));

vi.mock('server-only', () => ({}));
vi.mock('../lib/prisma', () => ({ prisma: db }));

import { computeStats, createPost, isAuthor, listPosts, liveWhere, markRead, updatePost } from '../lib/bulletin';
import { DEFAULT_MODULES } from '../lib/module-catalog';

const NOW = new Date('2026-11-09T09:00:00Z');

function row(partial: Partial<Parameters<typeof serializeShape>[0]> = {}) {
  return serializeShape({
    id: 1,
    title: 'Office closed Friday',
    body: 'The office is closed on Friday for the public holiday.',
    category: 'Announcement',
    pinned: false,
    expiresAt: null,
    createdAt: new Date('2026-11-08T09:00:00Z'),
    updatedAt: new Date('2026-11-08T09:00:00Z'),
    author: { id: 7, name: 'Reagan' },
    _count: { reads: 3 },
    reads: [],
    ...partial,
  });
}
function serializeShape<T>(value: T): T {
  return value;
}

beforeEach(() => {
  for (const table of Object.values(db)) for (const fn of Object.values(table)) fn.mockReset();
});

describe('the board', () => {
  it('is registered as a module in the Communication group', () => {
    const entry = DEFAULT_MODULES.find((m) => m.slug === 'bulletin-board');
    expect(entry).toMatchObject({ name: 'Bulletin Board', category: 'Communication' });
  });

  it('lists live notices pinned-first and marks what the caller has seen', async () => {
    db.bulletinPost.findMany.mockResolvedValue([
      row({ id: 2, pinned: true, reads: [{ id: 9 }] }),
      row({ id: 1 }),
    ]);

    const posts = await listPosts(42, { now: NOW });

    const args = db.bulletinPost.findMany.mock.calls[0]![0];
    expect(args.where).toEqual(liveWhere(NOW));
    expect(args.orderBy).toEqual([{ pinned: 'desc' }, { createdAt: 'desc' }]);
    // Only the caller's own read is fetched per post, never everyone's.
    expect(args.include.reads).toEqual({ where: { userId: 42 }, select: { id: true }, take: 1 });
    expect(posts.map((p) => [p.id, p.readByMe, p.readCount])).toEqual([
      [2, true, 3],
      [1, false, 3],
    ]);
  });

  it('keeps expired notices off the board unless asked, and flags them when shown', async () => {
    db.bulletinPost.findMany.mockResolvedValue([row({ id: 3, expiresAt: new Date('2026-11-01T23:59:59Z') })]);

    const posts = await listPosts(42, { includeExpired: true, now: NOW });

    expect(db.bulletinPost.findMany.mock.calls[0]![0].where).toEqual({});
    expect(posts[0]!.expired).toBe(true);
  });

  it('counts what is new for the caller, what is pinned, and this week’s posts', () => {
    const posts = [
      { ...row({ id: 1, pinned: true }), expiresAt: null, expired: false, readByMe: false, createdAt: '2026-11-08T09:00:00Z' },
      { ...row({ id: 2 }), expiresAt: null, expired: false, readByMe: true, createdAt: '2026-10-01T09:00:00Z' },
      { ...row({ id: 3 }), expiresAt: '2026-11-01T23:59:59Z', expired: true, readByMe: false, createdAt: '2026-11-07T09:00:00Z' },
    ].map((p) => ({ ...p, updatedAt: p.createdAt, readCount: 3 }));

    expect(computeStats(posts, NOW)).toEqual({ unread: 1, pinned: 1, active: 2, thisWeek: 2 });
  });
});

describe('posting', () => {
  it('trims, defaults the category, reads "through the end of" the chosen day, and counts the author as having seen it', async () => {
    db.bulletinPost.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      row({ ...(data as object), _count: { reads: 1 }, reads: [{ id: 1 }] } as never),
    );

    const post = await createPost({ userId: 7, title: '  Fire drill  ', body: ' Thursday 10:00 ', category: 'Nonsense', expiresAt: '2026-11-20' });

    const data = db.bulletinPost.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({ title: 'Fire drill', body: 'Thursday 10:00', category: 'Announcement', pinned: false, authorId: 7 });
    expect(data.expiresAt.toISOString()).toBe('2026-11-20T23:59:59.999Z');
    expect(data.reads).toEqual({ create: { userId: 7 } });
    expect(post.readByMe).toBe(true);
  });

  it('refuses an empty title or body', async () => {
    await expect(createPost({ userId: 7, title: '', body: 'x' })).rejects.toThrow('A title is required');
    await expect(createPost({ userId: 7, title: 'x', body: '   ' })).rejects.toThrow('Write the notice before posting it');
    expect(db.bulletinPost.create).not.toHaveBeenCalled();
  });

  it('changes only the fields sent, and clears an expiry with null', async () => {
    db.bulletinPost.findUnique.mockResolvedValue({ id: 1 });
    db.bulletinPost.update.mockResolvedValue(row({ pinned: true }));

    await updatePost(1, 42, { pinned: true, expiresAt: null });

    expect(db.bulletinPost.update.mock.calls[0]![0].data).toEqual({ pinned: true, expiresAt: null });
  });

  it('knows who wrote a notice, and that a missing one is nobody’s', async () => {
    db.bulletinPost.findUnique.mockResolvedValueOnce({ authorId: 7 }).mockResolvedValueOnce({ authorId: 7 }).mockResolvedValueOnce(null);
    expect(await isAuthor(1, 7)).toBe(true);
    expect(await isAuthor(1, 8)).toBe(false);
    expect(await isAuthor(99, 7)).toBeNull();
  });
});

describe('seen', () => {
  it('records a read once per person, no matter how often they open it', async () => {
    db.bulletinPost.findUnique.mockResolvedValueOnce({ id: 1 }).mockResolvedValueOnce(row({ _count: { reads: 4 }, reads: [{ id: 5 }] }));

    const post = await markRead(1, 42);

    expect(db.bulletinRead.upsert).toHaveBeenCalledWith({
      where: { postId_userId: { postId: 1, userId: 42 } },
      create: { postId: 1, userId: 42 },
      update: {},
    });
    expect(post).toMatchObject({ readByMe: true, readCount: 4 });
  });

  it('returns null for a notice that is gone', async () => {
    db.bulletinPost.findUnique.mockResolvedValue(null);
    expect(await markRead(99, 42)).toBeNull();
    expect(db.bulletinRead.upsert).not.toHaveBeenCalled();
  });
});
