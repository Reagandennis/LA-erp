import { NextRequest, NextResponse } from 'next/server';

import { API_ACCESS } from '@/lib/api-access';
import { requireModuleRequest } from '@/lib/request-auth';
import {
  getOrCreateDirectConversation,
  listConversationsForUser,
} from '@/lib/communication';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.communication);
  if (response || !auth) return response;

  const conversations = await listConversationsForUser(auth.user.id);
  return NextResponse.json({ conversations });
}

export async function POST(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.communication);
  if (response || !auth) return response;

  const body = await request.json().catch(() => null);
  const otherUserId = Number(body?.userId);
  if (!Number.isInteger(otherUserId) || otherUserId <= 0) {
    return NextResponse.json({ error: 'Invalid user id' }, { status: 400 });
  }
  if (otherUserId === auth.user.id) {
    return NextResponse.json(
      { error: 'Cannot start a conversation with yourself' },
      { status: 400 },
    );
  }

  try {
    const conversationId = await getOrCreateDirectConversation(auth.user.id, otherUserId);
    return NextResponse.json({ conversationId }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not create conversation';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
