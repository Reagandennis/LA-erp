import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRequestAuth } from '@/lib/request-auth';

type Params = { params: Promise<{ attachId: string }> };

/* GET /api/chat/attachments/[attachId] — serve file bytes */
export async function GET(req: NextRequest, { params }: Params) {
  const { auth, response } = await requireRequestAuth(req);
  if (response) return response;

  const { attachId } = await params;
  const attachment = await prisma.chatAttachment.findUnique({
    where: { id: Number(attachId) },
    include: {
      message: {
        include: {
          conversation: { include: { members: { select: { userId: true } } } },
        },
      },
    },
  });

  if (!attachment) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const isMember = attachment.message.conversation.members.some(
    (m) => m.userId === auth!.user.id,
  );
  if (!isMember) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Drive-linked file — redirect to the URL
  if (attachment.driveUrl) {
    return NextResponse.redirect(attachment.driveUrl);
  }

  if (!attachment.content) {
    return NextResponse.json({ error: 'No content' }, { status: 404 });
  }

  return new NextResponse(attachment.content as any, {
    headers: {
      'Content-Type': attachment.mimeType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(attachment.filename)}"`,
      'Content-Length': String(attachment.size),
    },
  });
}
