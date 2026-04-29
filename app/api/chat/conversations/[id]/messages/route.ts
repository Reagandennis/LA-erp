import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRequestAuth } from '@/lib/request-auth';
import { broadcastToMembers } from '@/lib/chat-bus';

type Params = { params: Promise<{ id: string }> };

/* GET /api/chat/conversations/[id]/messages?cursor=&limit= */
export async function GET(req: NextRequest, { params }: Params) {
  const { auth, response } = await requireRequestAuth(req);
  if (response) return response;

  const { id } = await params;
  const convId = Number(id);

  // Ensure membership
  const member = await prisma.chatMember.findUnique({
    where: { conversationId_userId: { conversationId: convId, userId: auth!.user.id } },
  });
  if (!member) return NextResponse.json({ error: 'Not a member' }, { status: 403 });

  const url = new URL(req.url);
  const cursor = url.searchParams.get('cursor');
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 100);

  const messages = await prisma.chatMessage.findMany({
    where: { conversationId: convId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    ...(cursor ? { cursor: { id: Number(cursor) }, skip: 1 } : {}),
    include: {
      sender: { select: { id: true, name: true } },
      attachments: {
        select: { id: true, filename: true, mimeType: true, size: true, driveUrl: true, driveFileId: true },
      },
      reactions: {
        select: { id: true, userId: true, emoji: true },
      },
    },
  });

  return NextResponse.json({
    messages: messages.reverse(),
    nextCursor: messages.length === limit ? messages[0]?.id : null,
  });
}

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

type AttachmentRow = {
  filename: string;
  mimeType: string;
  size: number;
  content?: Buffer;
  driveUrl?: string;
  driveFileId?: string;
};

async function parseMultipart(
  form: FormData,
): Promise<{ body: string; attachmentRows: AttachmentRow[] }> {
  const rawBody = form.get('body');
  const body = (typeof rawBody === 'string' ? rawBody : '').trim();
  const attachmentRows: AttachmentRow[] = [];

  const files = form.getAll('files') as File[];
  for (const file of files) {
    const buf = Buffer.from(await file.arrayBuffer());
    attachmentRows.push({
      filename: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      content: buf,
    });
  }

  const driveRaw = form.get('driveFiles');
  if (driveRaw && typeof driveRaw === 'string') {
    const driveFiles = JSON.parse(driveRaw) as {
      name: string; mimeType: string; size: number; url: string; fileId: string;
    }[];
    for (const df of driveFiles) {
      attachmentRows.push({
        filename: df.name, mimeType: df.mimeType, size: df.size,
        driveUrl: df.url, driveFileId: df.fileId,
      });
    }
  }

  return { body, attachmentRows };
}

async function parseBody(
  req: NextRequest,
): Promise<{ body: string; attachmentRows: AttachmentRow[] }> {
  const contentType = req.headers.get('content-type') ?? '';
  if (contentType.includes('multipart/form-data')) {
    return parseMultipart(await req.formData());
  }
  const json = (await req.json()) as { body: string };
  const rawBody = json.body;
  return { body: (typeof rawBody === 'string' ? rawBody : '').trim(), attachmentRows: [] };
}

/* POST /api/chat/conversations/[id]/messages — send message (multipart or JSON) */
export async function POST(req: NextRequest, { params }: Params) {
  const { auth, response } = await requireRequestAuth(req);
  if (response) return response;

  const { id } = await params;
  const convId = Number(id);

  const member = await prisma.chatMember.findUnique({
    where: { conversationId_userId: { conversationId: convId, userId: auth!.user.id } },
  });
  if (!member) return NextResponse.json({ error: 'Not a member' }, { status: 403 });

  const { body, attachmentRows } = await parseBody(req);

  if (!body && attachmentRows.length === 0) {
    return NextResponse.json({ error: 'Empty message' }, { status: 400 });
  }

  const message = await prisma.chatMessage.create({
    data: {
      conversationId: convId,
      senderId: auth!.user.id,
      body,
      attachments: attachmentRows.length ? { create: attachmentRows } : undefined,
    },
    include: {
      sender: { select: { id: true, name: true } },
      attachments: {
        select: { id: true, filename: true, mimeType: true, size: true, driveUrl: true, driveFileId: true },
      },
      reactions: {
        select: { id: true, userId: true, emoji: true },
      },
    },
  });

  // Update conversation updatedAt
  await prisma.chatConversation.update({ where: { id: convId }, data: { updatedAt: new Date() } });

  // Push SSE event to all members
  const members = await prisma.chatMember.findMany({ where: { conversationId: convId } });
  broadcastToMembers(
    members.map((m: { userId: number }) => m.userId),
    'message',
    { conversationId: convId, message },
  );

  return NextResponse.json(message, { status: 201 });
}
