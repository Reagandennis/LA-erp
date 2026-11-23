import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { requireAdminRequest } from '@/lib/request-auth';
import { GroupError, deleteGroup, listGroups, updateGroup } from '@/lib/user-groups';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ groupId: string }> };

/** Rename a group, change its description, or replace its members. */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { auth, response } = await requireAdminRequest(request);
  if (response || !auth) return response;
  const id = Number((await params).groupId);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'Group not found' }, { status: 404 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  try {
    const group = await updateGroup(id, body);
    if (!group) return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    await recordAuditEvent({
      action: 'admin.group.updated',
      entityType: 'group',
      entityId: String(group.id),
      actorUserId: auth.user.id,
      metadata: { name: group.name, memberIds: group.members.map((m) => m.id) },
      request,
    });
    return NextResponse.json({ group, groups: await listGroups() });
  } catch (error) {
    if (error instanceof GroupError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { auth, response } = await requireAdminRequest(request);
  if (response || !auth) return response;
  const id = Number((await params).groupId);
  const group = Number.isInteger(id) ? await deleteGroup(id) : null;
  if (!group) return NextResponse.json({ error: 'Group not found' }, { status: 404 });
  await recordAuditEvent({
    action: 'admin.group.deleted',
    entityType: 'group',
    entityId: String(group.id),
    actorUserId: auth.user.id,
    metadata: { name: group.name },
    request,
  });
  return NextResponse.json({ deleted: true, groups: await listGroups() });
}
