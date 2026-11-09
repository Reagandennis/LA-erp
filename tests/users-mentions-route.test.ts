import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findMany, requireRequestAuth } = vi.hoisted(() => ({ findMany: vi.fn(), requireRequestAuth: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('../lib/prisma', () => ({ prisma: { user: { findMany } } }));
vi.mock('../lib/request-auth', () => ({ requireRequestAuth }));

import { GET } from '../app/api/users/mentions/route';

function get(query = '') {
  return new NextRequest(`http://localhost/api/users/mentions${query}`);
}

beforeEach(() => {
  findMany.mockReset();
  requireRequestAuth.mockReset();
  requireRequestAuth.mockResolvedValue({ auth: { user: { id: 1, name: 'Me' } }, response: null });
});

describe('GET /api/users/mentions', () => {
  it('lists every colleague by name, without emails, so an @ picker can open on it', async () => {
    findMany.mockResolvedValue([{ id: 2, name: 'Mary Wanjiku' }, { id: 3, name: 'Peter Kamau' }]);

    const response = await GET(get());
    const body = (await response.json()) as { users: Array<{ id: number; name: string; email: string | null }> };

    expect(body.users).toEqual([
      { id: 2, name: 'Mary Wanjiku', email: null },
      { id: 3, name: 'Peter Kamau', email: null },
    ]);
    expect(findMany).toHaveBeenCalledWith({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: 200,
    });
  });

  it('searches name and email once there are two characters to go on', async () => {
    findMany.mockResolvedValue([{ id: 2, name: 'Mary Wanjiku', email: 'mary@example.com' }]);

    const response = await GET(get('?q=ma'));
    const body = (await response.json()) as { users: unknown[] };

    expect(body.users).toHaveLength(1);
    const args = findMany.mock.calls[0]![0];
    expect(args.where.status).toBeUndefined();
    expect(args.where.OR).toEqual([
      { name: { contains: 'ma', mode: 'insensitive' } },
      { email: { contains: 'ma', mode: 'insensitive' } },
    ]);
  });

  it('answers nothing to someone not signed in', async () => {
    const denied = new Response(null, { status: 401 });
    requireRequestAuth.mockResolvedValue({ auth: null, response: denied });
    expect(await GET(get())).toBe(denied);
    expect(findMany).not.toHaveBeenCalled();
  });
});
