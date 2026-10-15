import 'server-only';

import { isDormant, isNeverUsed } from './admin-rules';
import { getEmailConfigStatus } from './email';
import { prisma } from './prisma';
import { ADMIN_ROLE_NAME } from './rbac';
import { lastActivityByUser } from './user';
import { describeWacliRuntime, runWacli } from './wacli-runtime';

/**
 * Read models behind the admin console's Overview and Sessions tabs.
 *
 * Everything here is computed from data the app already keeps (sessions, the
 * audit log, users and their grants); nothing new is tracked for it.
 */

/** Seen within this window counts as "active now". */
const ACTIVE_NOW_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Days of sign-in history on the overview chart. */
const SIGN_IN_DAYS = 14;

// --- Sessions ------------------------------------------------------------------

export interface AdminSession {
  id: string;
  user: { id: number; name: string; email: string };
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  /** The session making this request: revoking it would sign the admin out. */
  current: boolean;
}

/** Every session that is neither revoked nor expired, most recently active first. */
export async function listActiveSessions(currentSessionId: string): Promise<AdminSession[]> {
  const rows = await prisma.session.findMany({
    where: { revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: 'desc' },
    take: 500,
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    user: row.user,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    current: row.id === currentSessionId,
  }));
}

/** Revoke one session. Returns its owner, or null if it was already gone. */
export async function revokeSession(sessionId: string) {
  const session = await prisma.session.findFirst({
    where: { id: sessionId, revokedAt: null },
    select: { id: true, userId: true },
  });
  if (!session) return null;
  await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
  return session;
}

/** Revoke all of a user's sessions except `keepSessionId`. Returns how many. */
export async function revokeUserSessions(userId: number, keepSessionId?: string): Promise<number> {
  const result = await prisma.session.updateMany({
    where: { userId, revokedAt: null, ...(keepSessionId ? { id: { not: keepSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

// --- Overview ------------------------------------------------------------------

export type AttentionTone = 'critical' | 'warning' | 'info';

export interface AttentionItem {
  id: string;
  tone: AttentionTone;
  title: string;
  detail: string;
  /** Where the console should take the admin to deal with it. */
  action?: { label: string; tab: 'users' | 'roles' | 'sessions' | 'audit' | 'settings'; filter?: string };
}

export type HealthState = 'ok' | 'warning' | 'down';

export interface HealthCheck {
  name: string;
  state: HealthState;
  detail: string;
}

export interface AdminOverview {
  generatedAt: string;
  users: { total: number; active: number; suspended: number; inactive: number; admins: number };
  activeNow: number;
  activeSessions: number;
  signIns: {
    last24h: { succeeded: number; failed: number };
    /** Oldest first, one entry per day (YYYY-MM-DD, server time). */
    daily: Array<{ date: string; succeeded: number; failed: number }>;
  };
  attention: AttentionItem[];
  health: HealthCheck[];
}

function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Sign-ins per day, oldest first. Pure, so the bucketing (including days with
 * no sign-ins at all) is testable without a database.
 */
export function bucketSignIns(
  events: Array<{ action: string; createdAt: Date }>,
  now: Date,
  days = SIGN_IN_DAYS,
): AdminOverview['signIns']['daily'] {
  const buckets = new Map<string, { succeeded: number; failed: number }>();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  for (let i = 0; i < days; i++) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    buckets.set(dayKey(day), { succeeded: 0, failed: 0 });
  }
  for (const event of events) {
    const bucket = buckets.get(dayKey(event.createdAt));
    if (!bucket) continue;
    if (event.action === 'auth.login.succeeded') bucket.succeeded++;
    else if (event.action === 'auth.login.failed') bucket.failed++;
  }
  return [...buckets].map(([date, counts]) => ({ date, ...counts }));
}

async function databaseCheck(): Promise<HealthCheck> {
  const started = performance.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const ms = Math.round(performance.now() - started);
    return { name: 'Database', state: ms > 500 ? 'warning' : 'ok', detail: `Responding in ${ms} ms` };
  } catch {
    return { name: 'Database', state: 'down', detail: 'Not responding' };
  }
}

function emailCheck(): HealthCheck {
  const status = getEmailConfigStatus();
  return status.configured
    ? { name: 'Email delivery', state: 'ok', detail: 'Configured' }
    : { name: 'Email delivery', state: 'warning', detail: 'Not configured: welcome emails and emailed quotes and invoices are off' };
}

async function whatsappCheck(): Promise<HealthCheck> {
  const { stdout, error } = await runWacli(['version'], { timeoutMs: 5_000 });
  return !error && stdout.trim()
    ? { name: 'WhatsApp runtime', state: 'ok', detail: `Running (${describeWacliRuntime()})` }
    : { name: 'WhatsApp runtime', state: 'down', detail: `Unavailable (${describeWacliRuntime()})` };
}

async function exchangeRateCheck(now: Date): Promise<HealthCheck> {
  const snapshot = await prisma.exchangeRateSnapshot.findFirst({ orderBy: { fetchedAt: 'desc' } }).catch(() => null);
  if (!snapshot) {
    return { name: 'Exchange rates', state: 'warning', detail: 'No rate saved yet: reports stay in the base currency' };
  }
  const hours = Math.round((now.getTime() - snapshot.fetchedAt.getTime()) / (60 * 60 * 1000));
  const age = hours < 1 ? 'less than an hour ago' : `${plural(hours, 'hour', 'hours')} ago`;
  return {
    name: 'Exchange rates',
    state: hours > 48 ? 'warning' : 'ok',
    detail: `Updated ${age}`,
  };
}

export async function getAdminOverview(now = new Date()): Promise<AdminOverview> {
  const since24h = new Date(now.getTime() - DAY_MS);
  const chartStart = new Date(now);
  chartStart.setHours(0, 0, 0, 0);
  chartStart.setDate(chartStart.getDate() - (SIGN_IN_DAYS - 1));

  const [users, liveSessions, lastSeenBy, signInEvents, health] = await Promise.all([
    prisma.user.findMany({
      select: {
        id: true,
        status: true,
        createdAt: true,
        userModules: { select: { id: true }, take: 1 },
        userRoles: { select: { role: { select: { name: true, roleModules: { select: { id: true }, take: 1 } } } } },
      },
    }),
    prisma.session.findMany({
      where: { revokedAt: null, expiresAt: { gt: now } },
      select: { userId: true, lastSeenAt: true },
    }),
    lastActivityByUser(),
    prisma.auditLog.findMany({
      where: { action: { in: ['auth.login.succeeded', 'auth.login.failed'] }, createdAt: { gte: chartStart } },
      select: { action: true, createdAt: true },
    }),
    Promise.all([databaseCheck(), whatsappCheck(), exchangeRateCheck(now)]).then((checks) => [
      checks[0],
      emailCheck(),
      ...checks.slice(1),
    ]),
  ]);

  const isAdmin = (u: (typeof users)[number]) => u.userRoles.some((r) => r.role.name === ADMIN_ROLE_NAME);
  const activeUsers = users.filter((u) => u.status === 'active');
  const activeAdmins = activeUsers.filter(isAdmin).length;

  const activeNow = new Set(
    liveSessions.filter((s) => now.getTime() - s.lastSeenAt.getTime() <= ACTIVE_NOW_MS).map((s) => s.userId),
  ).size;

  const daily = bucketSignIns(signInEvents, now);
  const last24h = { succeeded: 0, failed: 0 };
  for (const event of signInEvents) {
    if (event.createdAt < since24h) continue;
    if (event.action === 'auth.login.succeeded') last24h.succeeded++;
    else last24h.failed++;
  }

  // --- What needs an admin's attention -------------------------------------
  const attention: AttentionItem[] = [];

  if (activeAdmins <= 1) {
    attention.push({
      id: 'single-admin',
      tone: 'warning',
      title: 'Only one active administrator',
      detail: 'If that account is locked out, nobody can manage users. Give a trusted colleague the admin role too.',
      action: { label: 'Open users', tab: 'users' },
    });
  }

  if (last24h.failed >= 5) {
    attention.push({
      id: 'failed-sign-ins',
      tone: last24h.failed >= 20 ? 'critical' : 'warning',
      title: `${plural(last24h.failed, 'failed sign-in', 'failed sign-ins')} in the last 24 hours`,
      detail: 'Check whether they come from one address or target one account.',
      action: { label: 'Review in audit log', tab: 'audit', filter: 'auth.login.failed' },
    });
  }

  const noAccess = activeUsers.filter(
    (u) => !isAdmin(u) && u.userModules.length === 0 && !u.userRoles.some((r) => r.role.roleModules.length > 0),
  );
  if (noAccess.length > 0) {
    attention.push({
      id: 'no-access',
      tone: 'warning',
      title: `${plural(noAccess.length, 'person', 'people')} can't open any module`,
      detail: 'Their roles grant no modules and they have none of their own. Give them a role with modules.',
      action: { label: 'Show them', tab: 'users', filter: 'no-access' },
    });
  }

  const neverSignedIn = activeUsers.filter((u) => isNeverUsed(u.createdAt, lastSeenBy.get(u.id), now));
  if (neverSignedIn.length > 0) {
    attention.push({
      id: 'never-signed-in',
      tone: 'info',
      title: `${plural(neverSignedIn.length, 'account has', 'accounts have')} never been used`,
      detail: 'Created more than three days ago and never signed in. Check they received their details.',
      action: { label: 'Show them', tab: 'users', filter: 'never-signed-in' },
    });
  }

  const dormant = activeUsers.filter((u) => isDormant(lastSeenBy.get(u.id), now));
  if (dormant.length > 0) {
    attention.push({
      id: 'dormant',
      tone: 'info',
      title: `${plural(dormant.length, 'account', 'accounts')} unused for 30+ days`,
      detail: 'Consider setting them to inactive if these people have left.',
      action: { label: 'Show them', tab: 'users', filter: 'dormant' },
    });
  }

  for (const check of health) {
    if (check.state === 'down') {
      attention.push({ id: `health-${check.name}`, tone: 'critical', title: `${check.name} is down`, detail: check.detail });
    }
  }

  const order: Record<AttentionTone, number> = { critical: 0, warning: 1, info: 2 };
  attention.sort((a, b) => order[a.tone] - order[b.tone]);

  return {
    generatedAt: now.toISOString(),
    users: {
      total: users.length,
      active: activeUsers.length,
      suspended: users.filter((u) => u.status === 'suspended').length,
      inactive: users.filter((u) => u.status === 'inactive').length,
      admins: users.filter(isAdmin).length,
    },
    activeNow,
    activeSessions: liveSessions.length,
    signIns: { last24h, daily },
    attention,
    health,
  };
}
