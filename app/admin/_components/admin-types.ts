/**
 * Data the admin console works with. These are the server's own shapes,
 * imported as types only, so no server code reaches the browser bundle.
 */
import type { AdminOverview, AdminSession, AttentionItem, HealthCheck } from '@/lib/admin-console';
import type { AuditLogEntry, AuditQueryResult } from '@/lib/audit';
import type { AdminRoleSummary, ManagedUser, ModuleSummary } from '@/lib/user';

export type AdminUser = ManagedUser;
export type AdminRole = AdminRoleSummary;
export type AdminModule = ModuleSummary;
export type { AdminOverview, AdminSession, AttentionItem, AuditLogEntry, AuditQueryResult, HealthCheck };

export type AdminTab = 'overview' | 'users' | 'roles' | 'sessions' | 'audit' | 'settings';

/** Quick filters on the Users tab, opened from the overview's attention list. */
export type UserQuickFilter = 'no-access' | 'never-signed-in' | 'dormant';

export const ADMIN_ROLE = 'admin';

export function isAdminUser(user: AdminUser): boolean {
  return user.roles.some((r) => r.name === ADMIN_ROLE);
}
