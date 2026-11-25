import 'server-only';

import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasModule, userHasRole, type AccessUser } from '@/lib/user';

import { ALL_TOOLS, AREAS, CORE_TOOLS, type ToolArea } from './registry';
import type { ToolDefinition } from './types';

/** Whether this person may use a tool: admins everything, everyone else by its role and module gates. */
export function canUseTool(user: AccessUser, tool: ToolDefinition): boolean {
  if (userHasRole(user, ADMIN_ROLE_NAME)) return true;
  if (tool.requiredRole && !userHasRole(user, tool.requiredRole)) return false;
  if (!tool.requiredModule) return true;
  const modules = typeof tool.requiredModule === 'string' ? [tool.requiredModule] : tool.requiredModule;
  return modules.some((slug) => userHasModule(user, slug));
}

/**
 * The tools a given user is allowed to use. Used both to build the request
 * tool list and to re-check before executing any handler.
 */
export function scopeToolsForUser(user: AccessUser): ToolDefinition[] {
  return ALL_TOOLS.filter((tool) => canUseTool(user, tool));
}

export function findScopedTool(user: AccessUser, name: string): ToolDefinition | undefined {
  return scopeToolsForUser(user).find((t) => t.functionDeclaration.name === name);
}

export interface AreaAccess {
  /** Areas with at least one tool this person may use, holding only those tools. */
  open: ToolArea[];
  /** Areas this person has no way into: asking about them gets "ask IT for permission". */
  closed: ToolArea[];
  /** Always in hand, whatever is loaded. */
  core: ToolDefinition[];
}

/** The platform as this person may use it through the assistant. */
export function areasForUser(user: AccessUser): AreaAccess {
  const open: ToolArea[] = [];
  const closed: ToolArea[] = [];
  for (const area of AREAS) {
    const tools = area.tools.filter((tool) => canUseTool(user, tool));
    if (tools.length > 0) open.push({ ...area, tools });
    else closed.push(area);
  }
  return { open, closed, core: CORE_TOOLS.filter((tool) => canUseTool(user, tool)) };
}
