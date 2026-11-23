import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { requireAdminRequest } from '@/lib/request-auth';
import { GroupError, createGroup, listGroups } from '@/lib/user-groups';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { response } = await requireAdminRequest(request);
  if (response) return response;
  return NextResponse.json({ groups: await listGroups() });
}

/** Create a group: a name, an optional description and its members. */
export async function POST(request: NextRequest) {
  const { auth, response } = await requireAdminRequest(request);
  if (response || !auth) return response;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  try {
    const group = await createGroup(body);
    await recordAuditEvent({
      action: 'admin.group.created',
      entityType: 'group',
      entityId: String(group.id),
      actorUserId: auth.user.id,
      metadata: { name: group.name, memberIds: group.members.map((m) => m.id) },
      request,
    });
    return NextResponse.json({ group, groups: await listGroups() }, { status: 201 });
  } catch (error) {
    if (error instanceof GroupError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
