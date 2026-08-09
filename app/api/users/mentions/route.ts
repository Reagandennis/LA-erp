import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireRequestAuth } from '@/lib/request-auth';

export async function GET(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q')?.trim();

  // Require a real search term so this can't be used to dump the directory.
  if (!query || query.length < 2) {
    return NextResponse.json({ users: [] });
  }

  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
    },
    where: {
      OR: [
        {
          name: {
            contains: query,
            mode: 'insensitive',
          },
        },
        {
          email: {
            contains: query,
            mode: 'insensitive',
          },
        },
      ],
    },
    orderBy: {
      name: 'asc',
    },
    take: 20,
  });

  return NextResponse.json({ users });
}
