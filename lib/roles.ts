import 'server-only';

import { prisma } from './prisma';
import { ADMIN_ROLE_NAME } from './rbac';

/**
 * Custom roles: a role is a named bundle of modules. Everyone holding it can
 * open those modules, on top of any modules granted to them individually (see
 * `buildAccessUser`). The admin role is special: it already opens everything,
 * so it can't be renamed, given modules, or deleted.
 *
 * Access is read from the database on every request, so a change here applies
 * to the role's members on their next page load — nobody is signed out.
 */

export function isAdminRoleName(name: string): boolean {
  return name.trim().toLowerCase() === ADMIN_ROLE_NAME;
}

/** Another role already using this name, ignoring case ("Finance" = "finance"). */
export async function findRoleNameClash(name: string, exceptRoleId?: number) {
  return prisma.role.findFirst({
    where: {
      name: { equals: name.trim(), mode: 'insensitive' },
      ...(exceptRoleId ? { id: { not: exceptRoleId } } : {}),
    },
    select: { id: true, name: true },
  });
}

export async function findRole(roleId: number) {
  return prisma.role.findUnique({
    where: { id: roleId },
    select: { id: true, name: true, description: true, roleModules: { select: { moduleId: true } } },
  });
}

export async function modulesExist(moduleIds: number[]): Promise<boolean> {
  const unique = [...new Set(moduleIds)];
  if (unique.length === 0) return true;
  const found = await prisma['module'].count({ where: { id: { in: unique } } });
  return found === unique.length;
}

export async function createRole(input: { name: string; description: string; moduleIds: number[] }) {
  const moduleIds = [...new Set(input.moduleIds)];
  return prisma.role.create({
    data: {
      name: input.name.trim(),
      description: input.description.trim(),
      roleModules: { createMany: { data: moduleIds.map((moduleId) => ({ moduleId })) } },
    },
    select: { id: true, name: true },
  });
}

export async function updateRole(
  roleId: number,
  input: { name?: string; description?: string; moduleIds?: number[] },
) {
  return prisma.$transaction(async (tx) => {
    await tx.role.update({
      where: { id: roleId },
      data: {
        name: input.name?.trim(),
        description: input.description?.trim(),
      },
    });
    if (input.moduleIds) {
      const moduleIds = [...new Set(input.moduleIds)];
      await tx.roleModule.deleteMany({ where: { roleId } });
      if (moduleIds.length > 0) {
        await tx.roleModule.createMany({ data: moduleIds.map((moduleId) => ({ roleId, moduleId })) });
      }
    }
  });
}

export async function deleteRole(roleId: number): Promise<void> {
  await prisma.role.delete({ where: { id: roleId } });
}
