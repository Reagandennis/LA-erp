import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRequestAuth } from '@/lib/request-auth';

type Params = { params: Promise<{ id: string }> };

/* POST /api/chat/conversations/[id]/members — add member */
export async function POST(req: NextRequest, { params }: Params) {
  const { auth, response } = await requireRequestAuth(req);
  if (response) return response;

  const { id } = await params;
  const convId = Number(id);
  const { userId } = (await req.json()) as { userId: number };

  // Only existing members can add others
  const requester = await prisma.chatMember.findUnique({
    where: { conversationId_userId: { conversationId: convId, userId: auth!.user.id } },
  });
  if (!requester) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const member = await prisma.chatMember.upsert({
    where: { conversationId_userId: { conversationId: convId, userId } },
    create: { conversationId: convId, userId },
    update: {},
  });

  return NextResponse.json(member, { status: 201 });
}

/* DELETE /api/chat/conversations/[id]/members — remove self */
export async function DELETE(req: NextRequest, { params }: Params) {
  const { auth, response } = await requireRequestAuth(req);
  if (response) return response;

  const { id } = await params;
  const convId = Number(id);

  await prisma.chatMember.deleteMany({
    where: { conversationId: convId, userId: auth!.user.id },
  });

  return new NextResponse(null, { status: 204 });
}
