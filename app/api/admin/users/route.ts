import { NextRequest, NextResponse } from 'next/server';

import { hashPassword } from '@/lib/auth';
import { recordAuditEvent } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { enforceRateLimit } from '@/lib/rate-limit';
import { requireAdminRequest } from '@/lib/request-auth';
import {
  createManagedUser,
  getUserByEmail,
  listAllModules,
  listManagedUsers,
  listRolesWithPermissions,
} from '@/lib/user';
import { managedUserSchema } from '@/lib/validation';

async function ensureRolesExist(roleIds: number[]) {
  const roles = await prisma.role.findMany({
    where: {
      id: {
        in: roleIds,
      },
    },
    select: {
      id: true,
    },
  });

  return roles.length === roleIds.length;
}

async function ensureModulesExist(moduleIds: number[]) {
  if (moduleIds.length === 0) {
    return true;
  }

  const modules = await prisma['module'].findMany({
    where: {
      id: {
        in: moduleIds,
      },
    },
    select: {
      id: true,
    },
  });

  return modules.length === moduleIds.length;
}

export async function GET(request: NextRequest) {
  const { response } = await requireAdminRequest(request);

  if (response) {
    return response;
  }

  const [users, roles, modules] = await Promise.all([
    listManagedUsers(),
    listRolesWithPermissions(),
    listAllModules(),
  ]);

  return NextResponse.json({ users, roles, modules });
}

export async function POST(request: NextRequest) {
  const { auth, response } = await requireAdminRequest(request);

  if (response || !auth) {
    return response;
  }

  const rateLimit = await enforceRateLimit({
    scope: 'admin.user.create',
    key: `${auth.user.id}`,
    limit: 20,
    windowMs: 60 * 1000,
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error: 'Too many user-management actions. Slow down and try again.',
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      },
      { status: 429 },
    );
  }

  const body = await request.json().catch(() => null);
  const validation = managedUserSchema.safeParse(body);

  if (!validation.success) {
    return NextResponse.json(
      {
        error: validation.error.issues[0]?.message ?? 'Invalid input',
      },
      { status: 400 },
    );
  }

  const { email, name, password, roleIds, moduleIds, status } = validation.data;
  const [existingUser, rolesExist, modulesExist] = await Promise.all([
    getUserByEmail(email),
    ensureRolesExist(roleIds),
    ensureModulesExist(moduleIds),
  ]);

  if (existingUser) {
    return NextResponse.json(
      { error: 'A user with that email already exists' },
      { status: 409 },
    );
  }

  if (!rolesExist) {
    return NextResponse.json(
      { error: 'One or more selected roles are invalid' },
      { status: 400 },
    );
  }

  if (!modulesExist) {
    return NextResponse.json(
      { error: 'One or more selected modules are invalid' },
      { status: 400 },
    );
  }

  const user = await createManagedUser({
    email,
    name,
    passwordHash: await hashPassword(password),
    status,
    roleIds,
    moduleIds,
  });

  await recordAuditEvent({
    action: 'admin.user.created',
    entityType: 'user',
    entityId: String(user.id),
    actorUserId: auth.user.id,
    targetUserId: user.id,
    metadata: {
      email: user.email,
      roleIds,
      moduleIds,
      status: user.status,
    },
    request,
  });

  return NextResponse.json({ success: true, user }, { status: 201 });
}
