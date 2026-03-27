import { PrismaClient } from '@prisma/client';

import { hashPassword } from '../lib/auth';
import {
  ADMIN_ROLE_NAME,
  DEFAULT_PERMISSIONS,
  DEFAULT_ROLE_PERMISSION_NAMES,
  DEFAULT_ROLES,
} from '../lib/rbac';

const prisma = new PrismaClient();

async function seedRbac() {
  for (const role of DEFAULT_ROLES) {
    await prisma.role.upsert({
      where: { name: role.name },
      update: { description: role.description },
      create: role,
    });
  }

  for (const permission of DEFAULT_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { name: permission.name },
      update: {
        description: permission.description,
        resource: permission.resource,
        action: permission.action,
      },
      create: permission,
    });
  }

  const roles = await prisma.role.findMany();
  const permissions = await prisma.permission.findMany();
  const roleMap = new Map(roles.map((role) => [role.name, role.id]));
  const permissionMap = new Map(
    permissions.map((permission) => [permission.name, permission.id]),
  );

  for (const [roleName, permissionNames] of Object.entries(
    DEFAULT_ROLE_PERMISSION_NAMES,
  )) {
    const roleId = roleMap.get(roleName);

    if (!roleId) {
      throw new Error(`Missing seeded role "${roleName}"`);
    }

    for (const permissionName of permissionNames) {
      const permissionId = permissionMap.get(permissionName);

      if (!permissionId) {
        throw new Error(`Missing seeded permission "${permissionName}"`);
      }

      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId,
            permissionId,
          },
        },
        update: {},
        create: {
          roleId,
          permissionId,
        },
      });
    }
  }
}

async function seedBootstrapAdmin() {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const name = process.env.BOOTSTRAP_ADMIN_NAME?.trim() || 'Platform Admin';
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD?.trim();

  if (!email || !password) {
    throw new Error(
      'BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD are required for seeding',
    );
  }

  const passwordHash = await hashPassword(password);
  const adminRole = await prisma.role.findUnique({
    where: { name: ADMIN_ROLE_NAME },
  });

  if (!adminRole) {
    throw new Error('Admin role was not created during RBAC seeding');
  }

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      name,
      passwordHash,
      status: 'active',
      sessionVersion: { increment: 1 },
    },
    create: {
      email,
      name,
      passwordHash,
      status: 'active',
    },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: user.id,
        roleId: adminRole.id,
      },
    },
    update: {},
    create: {
      userId: user.id,
      roleId: adminRole.id,
    },
  });
}

async function main() {
  await seedRbac();
  await seedBootstrapAdmin();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
