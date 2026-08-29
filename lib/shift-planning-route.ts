import 'server-only';

import { NextRequest, NextResponse } from 'next/server';

import { ADMIN_ROLE_NAME } from './rbac';
import { requireRequestAuth } from './request-auth';
import { userHasModule, userHasRole } from './user';

/**
 * Gates for the shift-planning routes.
 *
 * Two levels, deliberately: holding the module lets you see the board and your
 * own shifts, but only a manager (admin) can change what other people are
 * rostered to do or approve their leave.
 */

const MODULE_SLUG = 'shift-planning';

type AuthUser = Parameters<typeof userHasRole>[0];

export interface PlanningContext {
  userId: number;
  /** True when this user may edit shifts, templates, teams and decide leave. */
  canManage: boolean;
}

export async function requireViewer(
  request: NextRequest,
): Promise<{ ctx: PlanningContext; response: null } | { ctx: null; response: NextResponse }> {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) {
    return {
      ctx: null,
      response: response ?? NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
    };
  }

  const user = auth.user as AuthUser;
  const isAdmin = userHasRole(user, ADMIN_ROLE_NAME);
  if (!isAdmin && !userHasModule(user, MODULE_SLUG)) {
    return { ctx: null, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { ctx: { userId: auth.user.id, canManage: isAdmin }, response: null };
}

/** As above, but rejects anyone who cannot manage the schedule. */
export async function requireManager(
  request: NextRequest,
): Promise<{ ctx: PlanningContext; response: null } | { ctx: null; response: NextResponse }> {
  const result = await requireViewer(request);
  if (result.response || !result.ctx) return result;
  if (!result.ctx.canManage) {
    return {
      ctx: null,
      response: NextResponse.json({ error: 'Only a manager can change the schedule.' }, { status: 403 }),
    };
  }
  return result;
}
