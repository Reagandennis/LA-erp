import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { enforceRateLimit } from '@/lib/rate-limit';
import { requireAdminRequest } from '@/lib/request-auth';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import {
  countAdmins,
  deleteManagedUser,
  getUserAccessById,
  isUserAdmin,
  updateManagedUser,
  userHasRole,
} from '@/lib/user';
import { managedUserUpdateSchema } from '@/lib/validation';

async function getAdminRoleId() {
  const role = await prisma.role.findUnique({
    where: { name: ADMIN_ROLE_NAME },
    select: { id: true },
  });

  return role?.id ?? null;
}

function parseUserId(value: string) {
  const userId = Number(value);
  return Number.isInteger(userId) && userId > 0 ? userId : null;
}

async function guardAdminMutation(request: NextRequest) {
  const result = await requireAdminRequest(request);

  if (result.response || !result.auth) {
    return result;
  }

  const rateLimit = await enforceRateLimit({
    scope: 'admin.user.mutate',
    key: `${result.auth.user.id}`,
    limit: 30,
    windowMs: 60 * 1000,
  });

  if (!rateLimit.allowed) {
    return {
      auth: null,
      response: NextResponse.json(
        {
          error: 'Too many admin changes. Slow down and try again.',
          retryAfterSeconds: rateLimit.retryAfterSeconds,
        },
        { status: 429 },
      ),
    };
  }

  return result;
}

async function modulesExist(moduleIds: number[]) {
  if (moduleIds.length === 0) {
    return true;
  }

  const modules = await prisma['module'].findMany({
    where: {
      id: {
        in: moduleIds,
      },
    },
    select: { id: true },
  });

  return modules.length === moduleIds.length;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { auth, response } = await guardAdminMutation(request);

  if (response || !auth) {
    return response;
  }

  const { userId: rawUserId } = await params;
  const userId = parseUserId(rawUserId);

  if (!userId) {
    return NextResponse.json({ error: 'Invalid user id' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const validation = managedUserUpdateSchema.safeParse(body);

  if (!validation.success) {
    return NextResponse.json(
      {
        error: validation.error.issues[0]?.message ?? 'Invalid input',
      },
      { status: 400 },
    );
  }

  const adminRoleId = await getAdminRoleId();
  const targetBefore = await getUserAccessById(userId);

  if (!targetBefore) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const { roleIds, moduleIds, status } = validation.data;
  const targetIsAdmin = userHasRole(targetBefore, ADMIN_ROLE_NAME);

  if (auth.user.id === userId) {
    if (status && status !== 'active') {
      return NextResponse.json(
        { error: 'You cannot deactivate your own account' },
        { status: 400 },
      );
    }

    if (roleIds && adminRoleId && !roleIds.includes(adminRoleId)) {
      return NextResponse.json(
        { error: 'You cannot remove your own admin access' },
        { status: 400 },
      );
    }
  }

  if (
    targetIsAdmin &&
    ((status && status !== 'active') ||
      (roleIds && adminRoleId && !roleIds.includes(adminRoleId)))
  ) {
    const adminCount = await countAdmins();

    if (adminCount <= 1) {
      return NextResponse.json(
        { error: 'The last administrator cannot be deactivated or demoted' },
        { status: 400 },
      );
    }
  }

  if (roleIds) {
    const roles = await prisma.role.findMany({
      where: {
        id: {
          in: roleIds,
        },
      },
      select: { id: true },
    });

    if (roles.length !== roleIds.length) {
      return NextResponse.json(
        { error: 'One or more selected roles are invalid' },
        { status: 400 },
      );
    }
  }

  if (moduleIds && !(await modulesExist(moduleIds))) {
    return NextResponse.json(
      { error: 'One or more selected modules are invalid' },
      { status: 400 },
    );
  }

  const updatedUser = await updateManagedUser({
    userId,
    status,
    roleIds,
    moduleIds,
  });

  if (!updatedUser) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  await recordAuditEvent({
    action: 'admin.user.updated',
    entityType: 'user',
    entityId: String(userId),
    actorUserId: auth.user.id,
    targetUserId: userId,
    metadata: {
      status: status ?? null,
      roleIds: roleIds ?? null,
      moduleIds: moduleIds ?? null,
    },
    request,
  });

  return NextResponse.json({ success: true, user: updatedUser });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { auth, response } = await guardAdminMutation(request);

  if (response || !auth) {
    return response;
  }

  const { userId: rawUserId } = await params;
  const userId = parseUserId(rawUserId);

  if (!userId) {
    return NextResponse.json({ error: 'Invalid user id' }, { status: 400 });
  }

  if (auth.user.id === userId) {
    return NextResponse.json(
      { error: 'You cannot delete your own account' },
      { status: 400 },
    );
  }

  const targetUser = await getUserAccessById(userId);

  if (!targetUser) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  if (await isUserAdmin(userId)) {
    const adminCount = await countAdmins();

    if (adminCount <= 1) {
      return NextResponse.json(
        { error: 'The last administrator cannot be deleted' },
        { status: 400 },
      );
    }
  }

  const deleted = await deleteManagedUser(userId);

  if (!deleted) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  await recordAuditEvent({
    action: 'admin.user.deleted',
    entityType: 'user',
    entityId: String(userId),
    actorUserId: auth.user.id,
    metadata: {
      email: targetUser.email,
    },
    request,
  });

  return NextResponse.json({ success: true });
}
