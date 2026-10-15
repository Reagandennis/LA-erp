import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { enforceRateLimit } from '@/lib/rate-limit';
import { requireAdminRequest } from '@/lib/request-auth';
import {
  deleteRole,
  findRole,
  findRoleNameClash,
  isAdminRoleName,
  modulesExist,
  updateRole,
} from '@/lib/roles';
import { countRoleMembers, listRolesForAdmin } from '@/lib/user';
import { roleUpdateSchema } from '@/lib/validation';

export const runtime = 'nodejs';

function parseRoleId(value: string) {
  const roleId = Number(value);
  return Number.isInteger(roleId) && roleId > 0 ? roleId : null;
}

async function guardRoleMutation(request: NextRequest) {
  const result = await requireAdminRequest(request);
  if (result.response || !result.auth) return result;

  const rateLimit = await enforceRateLimit({
    scope: 'admin.role.mutate',
    key: `${result.auth.user.id}`,
    limit: 30,
    windowMs: 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return {
      auth: null,
      response: NextResponse.json(
        { error: 'Too many role changes. Slow down and try again.', retryAfterSeconds: rateLimit.retryAfterSeconds },
        { status: 429 },
      ),
    };
  }
  return result;
}

/**
 * Rename a role, change its description, or replace its modules. The admin
 * role only takes a new description: it already opens every module, and its
 * name is what the rest of the app checks for.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ roleId: string }> }) {
  const { auth, response } = await guardRoleMutation(request);
  if (response || !auth) return response;

  const roleId = parseRoleId((await params).roleId);
  if (!roleId) return NextResponse.json({ error: 'Invalid role id' }, { status: 400 });

  const validation = roleUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!validation.success) {
    return NextResponse.json({ error: validation.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }
  const { name, description, moduleIds } = validation.data;

  const role = await findRole(roleId);
  if (!role) return NextResponse.json({ error: 'Role not found' }, { status: 404 });

  if (isAdminRoleName(role.name)) {
    if ((name !== undefined && name.trim() !== role.name) || moduleIds !== undefined) {
      return NextResponse.json(
        { error: 'The admin role always has every module and cannot be renamed' },
        { status: 400 },
      );
    }
  } else if (name !== undefined) {
    if (isAdminRoleName(name) || (await findRoleNameClash(name, roleId))) {
      return NextResponse.json({ error: `A role called "${name}" already exists` }, { status: 409 });
    }
  }
  if (moduleIds && !(await modulesExist(moduleIds))) {
    return NextResponse.json({ error: 'One or more selected modules are invalid' }, { status: 400 });
  }

  await updateRole(roleId, { name, description, moduleIds });

  const before = role.roleModules.map((rm) => rm.moduleId);
  await recordAuditEvent({
    action: 'admin.role.updated',
    entityType: 'role',
    entityId: String(roleId),
    actorUserId: auth.user.id,
    metadata: {
      name: name ?? role.name,
      ...(name !== undefined && name !== role.name ? { renamedFrom: role.name } : {}),
      ...(moduleIds
        ? {
            modulesAdded: moduleIds.filter((id) => !before.includes(id)),
            modulesRemoved: before.filter((id) => !moduleIds.includes(id)),
          }
        : {}),
    },
    request,
  });

  return NextResponse.json({ success: true, roles: await listRolesForAdmin() });
}

/**
 * Delete a custom role. A role that people still hold is refused rather than
 * silently taking their access away; move them to another role first.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ roleId: string }> }) {
  const { auth, response } = await guardRoleMutation(request);
  if (response || !auth) return response;

  const roleId = parseRoleId((await params).roleId);
  if (!roleId) return NextResponse.json({ error: 'Invalid role id' }, { status: 400 });

  const role = await findRole(roleId);
  if (!role) return NextResponse.json({ error: 'Role not found' }, { status: 404 });
  if (isAdminRoleName(role.name)) {
    return NextResponse.json({ error: 'The admin role cannot be deleted' }, { status: 400 });
  }

  const members = await countRoleMembers(roleId);
  if (members > 0) {
    return NextResponse.json(
      {
        error: `${members} ${members === 1 ? 'person has' : 'people have'} this role. Give them another role first.`,
      },
      { status: 409 },
    );
  }

  await deleteRole(roleId);
  await recordAuditEvent({
    action: 'admin.role.deleted',
    entityType: 'role',
    entityId: String(roleId),
    actorUserId: auth.user.id,
    metadata: { name: role.name, moduleIds: role.roleModules.map((rm) => rm.moduleId) },
    request,
  });

  return NextResponse.json({ success: true, roles: await listRolesForAdmin() });
}
