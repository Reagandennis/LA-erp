import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q')?.trim();

  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
    },
    where: query
      ? {
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
        }
      : undefined,
    orderBy: {
      name: 'asc',
    },
  });

  return NextResponse.json({ users });
}
