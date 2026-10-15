import 'server-only';

import { Prisma } from '@prisma/client';
import { cache } from 'react';

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

export interface ModuleSummary {
  id: number;
  slug: string;
  name: string;
  description: string;
  category: string;
  sortOrder: number;
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
  modules: ModuleSummary[];
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

export function userHasModule(user: AccessUser, moduleSlug: string) {
  return user.modules.some((module) => module.slug === moduleSlug);
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
          roleModules: {
            include: {
              module: true,
            },
          },
        },
      },
    },
  },
  userModules: {
    include: {
      module: true,
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

function serializeModule(
  module: UserWithAccess['userModules'][number]['module'],
): ModuleSummary {
  return {
    id: module.id,
    slug: module.slug,
    name: module.name,
    description: module.description,
    category: module.category,
    sortOrder: module.sortOrder,
  };
}

function buildModuleSummaryFromList(
  module: Awaited<ReturnType<typeof listAllModules>>[number],
): ModuleSummary {
  return {
    id: module.id,
    slug: module.slug,
    name: module.name,
    description: module.description,
    category: module.category,
    sortOrder: module.sortOrder,
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

  // Access is the union of the user's own grants and every role's modules,
  // so `userHasModule` honours roles everywhere without any caller changing.
  const moduleMap = new Map<number, ModuleSummary>();
  for (const assignment of user.userModules) {
    moduleMap.set(assignment.module.id, serializeModule(assignment.module));
  }
  for (const assignment of user.userRoles) {
    for (const roleModule of assignment.role.roleModules) {
      moduleMap.set(roleModule.module.id, serializeModule(roleModule.module));
    }
  }
  const modules = [...moduleMap.values()].sort((left, right) => left.sortOrder - right.sortOrder);

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
    modules,
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

export interface AdminRoleSummary {
  id: number;
  name: string;
  description: string;
  /** The admin role: every module, can't be renamed, emptied or deleted. */
  isAdmin: boolean;
  moduleIds: number[];
  memberCount: number;
  createdAt: string;
}

/** Roles for the admin console: admin first, then by name. */
export async function listRolesForAdmin(): Promise<AdminRoleSummary[]> {
  const roles = await prisma.role.findMany({
    include: {
      roleModules: { select: { moduleId: true } },
      _count: { select: { userRoles: true } },
    },
    orderBy: { name: 'asc' },
  });

  return roles
    .map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description,
      isAdmin: role.name === ADMIN_ROLE_NAME,
      moduleIds: role.roleModules.map((rm) => rm.moduleId),
      memberCount: role._count.userRoles,
      createdAt: role.createdAt.toISOString(),
    }))
    .sort((left, right) => Number(right.isAdmin) - Number(left.isAdmin));
}

// Deduplicated per request: the root layout and admin pages both need the
// module catalogue on the same render.
export const listAllModules = cache(async () => {
  return prisma['module'].findMany({
    orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
  });
});

export interface ManagedUser extends AccessUser {
  /** Modules granted to the user directly, as opposed to through a role. */
  directModuleIds: number[];
  /** Latest activity on any session, or null if they have never signed in. */
  lastSeenAt: string | null;
  /** Sessions that are neither revoked nor expired. */
  activeSessions: number;
}

/**
 * When each user was last active: the later of their newest session activity
 * and their newest successful sign-in. Sessions alone aren't enough, because
 * maintenance deletes them 30 days after they end; the audit log is kept.
 */
export async function lastActivityByUser(): Promise<Map<number, Date>> {
  const [sessions, signIns] = await Promise.all([
    prisma.session.groupBy({ by: ['userId'], _max: { lastSeenAt: true } }),
    prisma.auditLog.groupBy({
      by: ['actorUserId'],
      where: { action: 'auth.login.succeeded', actorUserId: { not: null } },
      _max: { createdAt: true },
    }),
  ]);
  const latest = new Map<number, Date>();
  const offer = (userId: number | null, at: Date | null) => {
    if (userId === null || !at) return;
    const seen = latest.get(userId);
    if (!seen || at > seen) latest.set(userId, at);
  };
  for (const row of sessions) offer(row.userId, row._max.lastSeenAt);
  for (const row of signIns) offer(row.actorUserId, row._max.createdAt);
  return latest;
}

export async function listManagedUsers(): Promise<ManagedUser[]> {
  const now = new Date();
  const [users, lastSeen, active] = await Promise.all([
    prisma.user.findMany({
      include: userAccessInclude,
      orderBy: {
        createdAt: 'desc',
      },
    }),
    lastActivityByUser(),
    prisma.session.groupBy({
      by: ['userId'],
      where: { revokedAt: null, expiresAt: { gt: now } },
      _count: { _all: true },
    }),
  ]);
  const activeBy = new Map(active.map((row) => [row.userId, row._count._all]));

  return users.map((user) => ({
    ...buildAccessUser(user),
    directModuleIds: user.userModules.map((assignment) => assignment.moduleId),
    lastSeenAt: lastSeen.get(user.id)?.toISOString() ?? null,
    activeSessions: activeBy.get(user.id) ?? 0,
  }));
}

/** Who holds a role, for checks before it is changed or deleted. */
export async function countRoleMembers(roleId: number): Promise<number> {
  return prisma.userRole.count({ where: { roleId } });
}

export async function createManagedUser(input: {
  email: string;
  name: string;
  passwordHash: string;
  status: string;
  roleIds: number[];
  moduleIds: number[];
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
        userModules: {
          createMany: {
            data: input.moduleIds.map((moduleId) => ({ moduleId })),
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
  name?: string;
  email?: string;
  status?: string;
  roleIds?: number[];
  moduleIds?: number[];
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
      input.status !== undefined ||
      input.roleIds !== undefined ||
      input.moduleIds !== undefined;

    await tx.user.update({
      where: { id: input.userId },
      data: {
        name: input.name,
        email: input.email,
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

    if (input.moduleIds !== undefined) {
      await tx.userModule.deleteMany({
        where: { userId: input.userId },
      });

      if (input.moduleIds.length > 0) {
        await tx.userModule.createMany({
          data: input.moduleIds.map((moduleId) => ({
            userId: input.userId,
            moduleId,
          })),
        });
      }
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

export async function resetManagedUserPassword(input: {
  userId: number;
  passwordHash: string;
  // When the admin resets their own password, the session performing the
  // change survives; every other session is still revoked.
  keepSessionId?: string;
}) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({
      where: { id: input.userId },
      select: { id: true },
    });

    if (!existing) {
      return null;
    }

    await tx.user.update({
      where: { id: input.userId },
      data: {
        passwordHash: input.passwordHash,
        sessionVersion: input.keepSessionId
          ? undefined
          : {
              increment: 1,
            },
      },
    });

    await tx.session.updateMany({
      where: {
        userId: input.userId,
        revokedAt: null,
        ...(input.keepSessionId ? { id: { not: input.keepSessionId } } : {}),
      },
      data: {
        revokedAt: new Date(),
      },
    });

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

export async function getAccessibleModulesForUser(user: AccessUser) {
  if (userHasRole(user, ADMIN_ROLE_NAME)) {
    const modules = await listAllModules();
    return modules.map(buildModuleSummaryFromList);
  }

  return user.modules;
}

export async function getModuleBySlug(slug: string) {
  return prisma['module'].findUnique({
    where: { slug },
  });
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
