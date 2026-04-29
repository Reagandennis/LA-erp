import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRequestAuth } from '@/lib/request-auth';

type Params = { params: Promise<{ id: string }> };

/* POST /api/chat/conversations/[id]/read — mark conversation as read */
export async function POST(req: NextRequest, { params }: Params) {
  const { auth, response } = await requireRequestAuth(req);
  if (response) return response;

  const { id } = await params;
  const convId = Number(id);

  await prisma.chatMember.updateMany({
    where: { conversationId: convId, userId: auth!.user.id },
    data: { lastReadAt: new Date() },
  });

  return new NextResponse(null, { status: 204 });
}
