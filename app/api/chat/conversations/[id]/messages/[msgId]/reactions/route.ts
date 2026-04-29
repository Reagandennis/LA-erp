import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRequestAuth } from '@/lib/request-auth';

type Params = { params: Promise<{ id: string; msgId: string }> };

/* POST — toggle reaction */
export async function POST(req: NextRequest, { params }: Params) {
  const { auth, response } = await requireRequestAuth(req);
  if (response) return response;

  const { msgId } = await params;
  const messageId = Number(msgId);
  const { emoji } = (await req.json()) as { emoji: string };

  const existing = await prisma.chatReaction.findUnique({
    where: { messageId_userId_emoji: { messageId, userId: auth!.user.id, emoji } },
  });

  if (existing) {
    await prisma.chatReaction.delete({ where: { id: existing.id } });
    return NextResponse.json({ removed: true });
  }

  const reaction = await prisma.chatReaction.create({
    data: { messageId, userId: auth!.user.id, emoji },
  });
  return NextResponse.json(reaction, { status: 201 });
}
