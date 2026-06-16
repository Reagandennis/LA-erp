import 'server-only';

import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasModule, userHasRole, type AccessUser } from '@/lib/user';

import { ALL_TOOLS } from './registry';
import type { ToolDefinition } from './types';

/**
 * The tools a given user is allowed to use. Admins get everything; everyone
 * else is filtered to tools whose requiredModule/requiredRole they hold. Used
 * both to build the request tool list (small prompt) and to re-check before
 * executing any handler.
 */
export function scopeToolsForUser(user: AccessUser): ToolDefinition[] {
  const isAdmin = userHasRole(user, ADMIN_ROLE_NAME);
  if (isAdmin) return ALL_TOOLS;
  return ALL_TOOLS.filter((tool) => {
    if (tool.requiredRole && !userHasRole(user, tool.requiredRole)) return false;
    if (tool.requiredModule && !userHasModule(user, tool.requiredModule)) return false;
    return true;
  });
}

export function findScopedTool(user: AccessUser, name: string): ToolDefinition | undefined {
  return scopeToolsForUser(user).find((t) => t.functionDeclaration.name === name);
}
