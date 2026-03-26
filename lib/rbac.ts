export const ADMIN_ROLE_NAME = 'admin';

export const DEFAULT_ROLES = [
  {
    name: 'admin',
    description: 'Administrator with full platform access',
  },
  {
    name: 'editor',
    description: 'Can manage business content and collaborate with teams',
  },
  {
    name: 'viewer',
    description: 'Read-only access to assigned information',
  },
] as const;

export const DEFAULT_PERMISSIONS = [
  {
    name: 'user:create',
    description: 'Create managed users',
    resource: 'user',
    action: 'create',
  },
  {
    name: 'user:read',
    description: 'Read managed users',
    resource: 'user',
    action: 'read',
  },
  {
    name: 'user:update',
    description: 'Update managed users',
    resource: 'user',
    action: 'update',
  },
  {
    name: 'user:delete',
    description: 'Delete managed users',
    resource: 'user',
    action: 'delete',
  },
  {
    name: 'role:manage',
    description: 'Assign and remove roles',
    resource: 'role',
    action: 'manage',
  },
  {
    name: 'audit:read',
    description: 'Review security and admin audit events',
    resource: 'audit',
    action: 'read',
  },
  {
    name: 'content:create',
    description: 'Create business content',
    resource: 'content',
    action: 'create',
  },
  {
    name: 'content:read',
    description: 'Read business content',
    resource: 'content',
    action: 'read',
  },
  {
    name: 'content:update',
    description: 'Update business content',
    resource: 'content',
    action: 'update',
  },
  {
    name: 'content:delete',
    description: 'Delete business content',
    resource: 'content',
    action: 'delete',
  },
] as const;

const allPermissionNames = DEFAULT_PERMISSIONS.map((permission) => permission.name);

export const DEFAULT_ROLE_PERMISSION_NAMES: Record<string, string[]> = {
  admin: allPermissionNames,
  editor: ['content:create', 'content:read', 'content:update'],
  viewer: ['content:read'],
};
