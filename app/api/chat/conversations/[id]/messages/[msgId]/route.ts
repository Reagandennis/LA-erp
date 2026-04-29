import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRequestAuth } from '@/lib/request-auth';
import { broadcastToMembers } from '@/lib/chat-bus';

type Params = { params: Promise<{ id: string; msgId: string }> };

/* PATCH /api/chat/conversations/[id]/messages/[msgId] — edit */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { auth, response } = await requireRequestAuth(req);
  if (response) return response;

  const { id, msgId } = await params;
  const convId = Number(id);
  const messageId = Number(msgId);

  const message = await prisma.chatMessage.findUnique({ where: { id: messageId } });
  if (!message || message.deletedAt) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (message.senderId !== auth!.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { body } = (await req.json()) as { body: string };
  const updated = await prisma.chatMessage.update({
    where: { id: messageId },
    data: { body, editedAt: new Date() },
    include: { sender: { select: { id: true, name: true } } },
  });

  const members = await prisma.chatMember.findMany({ where: { conversationId: convId } });
  broadcastToMembers(
    members.map((m) => m.userId),
    'message_updated',
    { conversationId: convId, message: updated },
  );

  return NextResponse.json(updated);
}

/* DELETE /api/chat/conversations/[id]/messages/[msgId] — soft-delete */
export async function DELETE(req: NextRequest, { params }: Params) {
  const { auth, response } = await requireRequestAuth(req);
  if (response) return response;

  const { id, msgId } = await params;
  const convId = Number(id);
  const messageId = Number(msgId);

  const message = await prisma.chatMessage.findUnique({ where: { id: messageId } });
  if (!message) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (message.senderId !== auth!.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await prisma.chatMessage.update({
    where: { id: messageId },
    data: { deletedAt: new Date() },
  });

  const members = await prisma.chatMember.findMany({ where: { conversationId: convId } });
  broadcastToMembers(
    members.map((m) => m.userId),
    'message_deleted',
    { conversationId: convId, messageId },
  );

  return new NextResponse(null, { status: 204 });
}
