import { NextRequest, NextResponse } from 'next/server';

import { API_ACCESS } from '@/lib/api-access';
import { requireModuleRequest } from '@/lib/request-auth';
import { listMessages, markConversationRead, sendMessage } from '@/lib/communication';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseId(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.communication);
  if (response || !auth) return response;

  const { conversationId: raw } = await params;
  const conversationId = parseId(raw);
  if (!conversationId) {
    return NextResponse.json({ error: 'Invalid conversation id' }, { status: 400 });
  }

  const messages = await listMessages(conversationId, auth.user.id);
  if (messages === null) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
  }

  await markConversationRead(conversationId, auth.user.id);
  return NextResponse.json({ messages });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.communication);
  if (response || !auth) return response;

  const { conversationId: raw } = await params;
  const conversationId = parseId(raw);
  if (!conversationId) {
    return NextResponse.json({ error: 'Invalid conversation id' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const text = typeof body?.body === 'string' ? body.body : '';
  if (!text.trim()) {
    return NextResponse.json({ error: 'Message body is required' }, { status: 400 });
  }

  const message = await sendMessage(conversationId, auth.user.id, text);
  if (message === null) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
  }

  return NextResponse.json({ message }, { status: 201 });
}
