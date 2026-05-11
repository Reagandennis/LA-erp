import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireRequestAuth } from '@/lib/request-auth';
import { personalTodoBoardSchema } from '@/lib/validation';


export async function GET(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);

  if (response || !auth) {
    return response;
  }

  const board = await prisma.personalTodoBoard.findUnique({
    where: { userId: auth.user.id },
  });

  if (!board) {
    return NextResponse.json({ board: null });
  }

  return NextResponse.json({
    board: {
      columns: board.columns,
      columnColors: board.columnColors ?? null,
    },
  });
}

export async function PUT(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);

  if (response || !auth) {
    return response;
  }

  const body = await request.json().catch(() => null);
  const validation = personalTodoBoardSchema.safeParse(body);

  if (!validation.success) {
    return NextResponse.json(
      { error: validation.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }

  const { columns, columnColors } = validation.data;

  const board = await prisma.personalTodoBoard.upsert({
    where: { userId: auth.user.id },
    update: {
      columns,
      columnColors: columnColors ?? undefined,
    },
    create: {
      userId: auth.user.id,
      columns,
      columnColors: columnColors ?? {},
    },
  });

  return NextResponse.json({
    success: true,
    board: {
      columns: board.columns,
      columnColors: board.columnColors ?? null,
    },
  });
}
