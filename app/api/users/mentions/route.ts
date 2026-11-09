import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireRequestAuth } from '@/lib/request-auth';

/**
 * Colleagues for @mentions and sharing pickers.
 *
 * Without a search term it lists every colleague by name only — what an
 * "@" picker needs to open on — and never their email addresses. Status
 * is not a filter: a task can be shared with someone who has not signed
 * in yet, and it is waiting for them when they do. A term of
 * two or more characters also searches email, for pickers that offer it.
 */
const DIRECTORY_LIMIT = 200;

export async function GET(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q')?.trim() ?? '';

  if (query.length < 2) {
    const users = await prisma.user.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: DIRECTORY_LIMIT,
    });
    return NextResponse.json({ users: users.map((user) => ({ id: user.id, name: user.name, email: null })) });
  }

  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true },
    where: {
      OR: [{ name: { contains: query, mode: 'insensitive' } }, { email: { contains: query, mode: 'insensitive' } }],
    },
    orderBy: { name: 'asc' },
    take: 20,
  });

  return NextResponse.json({ users });
}
