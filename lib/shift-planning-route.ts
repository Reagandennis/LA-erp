import 'server-only';

import { NextRequest, NextResponse } from 'next/server';

import { ADMIN_ROLE_NAME } from './rbac';
import { requireRequestAuth } from './request-auth';
import { type Actor, RosterError } from './shift-planning';
import { userHasModule, userHasRole } from './user';

/**
 * Gates for the shift-planning routes.
 *
 * Two modules, two levels. Shift Planning is what staff hold: it shows a
 * person their own published shifts and takes their leave requests. Shift
 * Planning Admin is the back office: only an admin, or someone granted that
 * module as a scheduler, can see everyone or change the roster.
 */

export const SHIFT_MODULE = 'shift-planning';
export const SHIFT_ADMIN_MODULE = 'shift-planning-admin';

type AuthUser = Parameters<typeof userHasRole>[0];

export interface PlanningContext {
  actor: Actor;
  /** True when this user may see every line and change the roster. */
  canManage: boolean;
}

type Gate = { ctx: PlanningContext; response: null } | { ctx: null; response: NextResponse };

export function canManageShifts(user: AuthUser): boolean {
  return userHasRole(user, ADMIN_ROLE_NAME) || userHasModule(user, SHIFT_ADMIN_MODULE);
}

/** Signed in and holding either shift module (or an admin). */
export async function requireViewer(request: NextRequest): Promise<Gate> {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) {
    return { ctx: null, response: response ?? NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) };
  }
  const user = auth.user as AuthUser;
  const canManage = canManageShifts(user);
  if (!canManage && !userHasModule(user, SHIFT_MODULE)) {
    return { ctx: null, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { ctx: { actor: { id: auth.user.id, name: auth.user.name }, canManage }, response: null };
}

/** As above, but only for someone who runs the roster. */
export async function requireManager(request: NextRequest): Promise<Gate> {
  const result = await requireViewer(request);
  if (result.response || !result.ctx) return result;
  if (!result.ctx.canManage) {
    return { ctx: null, response: NextResponse.json({ error: 'Only a scheduler can do that.' }, { status: 403 }) };
  }
  return result;
}

/** Runs a handler, turning a RosterError into a 400 the person can read. */
export async function respond(run: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof RosterError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error('[shift-planning]', error);
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}

export async function readJson(request: NextRequest): Promise<Record<string, unknown>> {
  const body = (await request.json().catch(() => null)) as unknown;
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new RosterError('Invalid request body.');
  return body as Record<string, unknown>;
}

/** The month to show: the one asked for, else the roster's current month. */
export function monthParam(request: NextRequest, fallback: string): string {
  const value = request.nextUrl.searchParams.get('month');
  return value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : fallback;
}
