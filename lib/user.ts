import { Prisma } from '@prisma/client';

import { ADMIN_ROLE_NAME } from './rbac';
import { prisma } from './prisma';

export interface PermissionSummary {
  id: number;
  name: string;
  description: string;
  resource: string;
  action: string;
}

export interface RoleSummary {
  id: number;
  name: string;
  description: string;
}

export interface AccessUser {
  id: number;
  email: string;
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  sessionVersion: number;
  roles: RoleSummary[];
  permissions: PermissionSummary[];
}

export interface AuditLogSummary {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  createdAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Prisma.JsonValue | null;
  actor: { id: number; email: string; name: string } | null;
  target: { id: number; email: string; name: string } | null;
}

export function userHasRole(user: AccessUser, roleName: string) {
  return user.roles.some((role) => role.name === roleName);
}

export const userAccessInclude = {
  userRoles: {
    include: {
      role: {
        include: {
          rolePermissions: {
            include: {
              permission: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.UserInclude;

type UserWithAccess = Prisma.UserGetPayload<{
  include: typeof userAccessInclude;
}>;

function serializeRole(role: UserWithAccess['userRoles'][number]['role']): RoleSummary {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
  };
}

function serializePermission(
  permission: UserWithAccess['userRoles'][number]['role']['rolePermissions'][number]['permission'],
): PermissionSummary {
  return {
    id: permission.id,
    name: permission.name,
    description: permission.description,
    resource: permission.resource,
    action: permission.action,
  };
}

export function buildAccessUser(user: UserWithAccess): AccessUser {
  const roles = user.userRoles.map((assignment) => serializeRole(assignment.role));
  const permissions = new Map<number, PermissionSummary>();

  for (const assignment of user.userRoles) {
    for (const rolePermission of assignment.role.rolePermissions) {
      permissions.set(
        rolePermission.permission.id,
        serializePermission(rolePermission.permission),
      );
    }
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    sessionVersion: user.sessionVersion,
    roles,
    permissions: [...permissions.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
  };
}

export async function getUserByEmail(email: string) {
  return prisma.user.findUnique({
    where: { email },
    include: userAccessInclude,
  });
}

export async function getUserAccessById(userId: number) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: userAccessInclude,
  });

  return user ? buildAccessUser(user) : null;
}

export async function listRolesWithPermissions() {
  const roles = await prisma.role.findMany({
    include: {
      rolePermissions: {
        include: {
          permission: true,
        },
      },
    },
    orderBy: {
      name: 'asc',
    },
  });

  return roles.map((role) => ({
    id: role.id,
    name: role.name,
    description: role.description,
    permissions: role.rolePermissions
      .map(({ permission }) => ({
        id: permission.id,
        name: permission.name,
        description: permission.description,
        resource: permission.resource,
        action: permission.action,
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  }));
}

export async function listManagedUsers() {
  const users = await prisma.user.findMany({
    include: userAccessInclude,
    orderBy: {
      createdAt: 'desc',
    },
  });

  return users.map(buildAccessUser);
}

export async function createManagedUser(input: {
  email: string;
  name: string;
  passwordHash: string;
  status: string;
  roleIds: number[];
}) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash: input.passwordHash,
        status: input.status,
        userRoles: {
          createMany: {
            data: input.roleIds.map((roleId) => ({ roleId })),
          },
        },
      },
      include: userAccessInclude,
    });

    return buildAccessUser(user);
  });
}

export async function updateManagedUser(input: {
  userId: number;
  status?: string;
  roleIds?: number[];
}) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({
      where: { id: input.userId },
      select: { id: true },
    });

    if (!existing) {
      return null;
    }

    const shouldResetSessions =
      input.status !== undefined || input.roleIds !== undefined;

    await tx.user.update({
      where: { id: input.userId },
      data: {
        status: input.status,
        sessionVersion: shouldResetSessions
          ? {
              increment: 1,
            }
          : undefined,
      },
    });

    if (input.roleIds) {
      await tx.userRole.deleteMany({
        where: { userId: input.userId },
      });

      await tx.userRole.createMany({
        data: input.roleIds.map((roleId) => ({
          userId: input.userId,
          roleId,
        })),
      });
    }

    if (shouldResetSessions) {
      await tx.session.updateMany({
        where: {
          userId: input.userId,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });
    }

    const updated = await tx.user.findUnique({
      where: { id: input.userId },
      include: userAccessInclude,
    });

    return updated ? buildAccessUser(updated) : null;
  });
}

export async function deleteManagedUser(userId: number) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!existing) {
      return false;
    }

    await tx.user.delete({
      where: { id: userId },
    });

    return true;
  });
}

export async function countAdmins() {
  return prisma.user.count({
    where: {
      userRoles: {
        some: {
          role: {
            name: ADMIN_ROLE_NAME,
          },
        },
      },
    },
  });
}

export async function isUserAdmin(userId: number) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      userRoles: {
        select: {
          role: {
            select: {
              name: true,
            },
          },
        },
      },
    },
  });

  return (
    user?.userRoles.some((assignment) => assignment.role.name === ADMIN_ROLE_NAME) ??
    false
  );
}

export async function getRecentAuditLogs(limit = 25): Promise<AuditLogSummary[]> {
  const logs = await prisma.auditLog.findMany({
    orderBy: {
      createdAt: 'desc',
    },
    take: limit,
    include: {
      actorUser: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
      targetUser: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
    },
  });

  return logs.map((log) => ({
    id: log.id,
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    createdAt: log.createdAt.toISOString(),
    ipAddress: log.ipAddress,
    userAgent: log.userAgent,
    metadata: log.metadata,
    actor: log.actorUser,
    target: log.targetUser,
  }));
}
