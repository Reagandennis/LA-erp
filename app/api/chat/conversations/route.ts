import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRequestAuth } from '@/lib/request-auth';

/* GET /api/chat/conversations — list my conversations with unread counts */
export async function GET(req: NextRequest) {
  const { auth, response } = await requireRequestAuth(req);
  if (response) return response;

  const memberships = await prisma.chatMember.findMany({
    where: { userId: auth!.user.id },
    include: {
      conversation: {
        include: {
          members: { include: { user: { select: { id: true, name: true } } } },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: { sender: { select: { id: true, name: true } } },
          },
        },
      },
    },
    orderBy: { conversation: { updatedAt: 'desc' } },
  });

  const result = memberships.map((m) => {
    const lastMsg = m.conversation.messages[0] ?? null;
    const unread = m.lastReadAt
      ? m.conversation.messages.filter(
          (msg) => msg.createdAt > m.lastReadAt! && msg.senderId !== auth!.user.id,
        ).length
      : 0;
    return {
      id: m.conversation.id,
      type: m.conversation.type,
      name: m.conversation.name,
      members: m.conversation.members.map((cm) => ({
        id: cm.user.id,
        name: cm.user.name,
      })),
      lastMessage: lastMsg
        ? {
            body: lastMsg.deletedAt ? '(deleted)' : lastMsg.body,
            senderName: lastMsg.sender.name,
            createdAt: lastMsg.createdAt,
          }
        : null,
      unreadCount: unread,
      updatedAt: m.conversation.updatedAt,
    };
  });

  return NextResponse.json(result);
}

/* POST /api/chat/conversations — create a DM or group */
export async function POST(req: NextRequest) {
  const { auth, response } = await requireRequestAuth(req);
  if (response) return response;

  let body: { type: 'DIRECT' | 'GROUP'; name?: string; memberIds: number[] };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { type, name } = body;
  // Coerce to integers — JSON numbers from client are safe, but guard against strings
  const memberIds = body.memberIds.map(Number).filter((n) => !Number.isNaN(n));
  const myId = Number(auth!.user.id);

  try {
    // For DMs, check if one already exists
    if (type === 'DIRECT' && memberIds.length === 1) {
      const otherId = memberIds[0];
      const existing = await prisma.chatConversation.findFirst({
        where: {
          type: 'DIRECT',
          AND: [
            { members: { some: { userId: myId } } },
            { members: { some: { userId: otherId } } },
          ],
        },
      });
      if (existing) return NextResponse.json({ id: existing.id }, { status: 200 });
    }

    const allMemberIds = Array.from(new Set([myId, ...memberIds]));

    const conv = await prisma.chatConversation.create({
      data: {
        type,
        name: type === 'GROUP' ? (name ?? 'Unnamed Group') : null,
        createdById: myId,
        members: {
          create: allMemberIds.map((uid) => ({ userId: uid })),
        },
      },
    });

    return NextResponse.json({ id: conv.id }, { status: 201 });
  } catch (err) {
    console.error('[chat/conversations POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
