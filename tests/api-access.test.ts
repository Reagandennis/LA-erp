import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';

import { describe, expect, it } from 'vitest';

import { API_ACCESS } from '../lib/api-access';
import { DEFAULT_MODULES } from '../lib/module-catalog';

/**
 * Every API method must check more than "is someone signed in": that the
 * caller holds the module (or is an admin), or that the data is theirs alone.
 *
 * Signing in was once the only check on dozens of routes, so anyone with an
 * account could read every contact, contract and intel report by calling the
 * API directly. This test reads each route and fails when a method relies on
 * sign-in alone without being on the allowlist below, with a reason.
 */

const API_DIR = fileURLToPath(new URL('../app/api', import.meta.url));

/** Calls that establish module or admin access (directly or through a route helper). */
const ACCESS_CHECKS =
  /requireModuleRequest\(|requireAdminRequest\(|!\s*userHasRole\([^)]*ADMIN_ROLE_NAME\)|userHasModule\(|canUseModule\(|resolveMessagingRequest\(|requireViewer\(|requireManager\(|resolveDriveRequest\(|backupAdminRequest\(/;

/** Route files built entirely by a factory that checks access itself. */
const GATED_FACTORIES = /makePhotoHandlers\(|createMediaGET\(|createSendMediaPOST\(/;

/** Sign-in is enough here, and why. Keep this list short. */
const SIGNED_IN_ONLY: Record<string, string> = {
  'auth/login': 'public: signs people in',
  'auth/signup': 'public: account requests',
  'auth/google': 'public: Google sign-in',
  'auth/logout': "the caller's own session",
  'auth/session': "the caller's own session",
  'messaging/webhook': 'called by wacli, authorised by a per-process secret',
  notifications: "the caller's own notifications",
  'calendar/notifications': "the caller's own notifications (polled by the bell)",
  'communication/notifications': "the caller's own notifications (polled by the bell)",
  'files/notifications': "the caller's own notifications (polled by the bell)",
  'invoices/notifications': "the caller's own notifications (polled by the bell)",
  'planning/notifications': "the caller's own notifications (polled by the bell)",
  'planning/trip-notifications': "the caller's own notifications (polled by the bell)",
  'quotes/notifications': "the caller's own notifications (polled by the bell)",
  'messaging/stream': "the caller's own live updates",
  presence: 'who is online, for everyone signed in',
  'preferences/world-clocks': "the caller's own preferences",
  'dashboard/highlights': "the caller's own dashboard",
  'users/mentions': 'colleague names for @mentions, used across modules',
  search: 'checks module and record access itself (lib/search)',
  'admin/organization': 'company name and logo, printed on quotes and invoices',
  'admin/organization/logo': 'company logo, printed on quotes and invoices',
  'quickbooks/callback': 'OAuth return; checked against the state the connect step stored',
  'wave/callback': 'OAuth return; checked against the state the connect step stored',
};

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return name === 'route.ts' ? [path] : [];
  });
}

interface MethodCheck {
  route: string;
  method: string;
  checked: boolean;
}

/** Each exported method, and whether its body (or a local helper it calls) checks access. */
function methodsOf(file: string): MethodCheck[] {
  const source = readFileSync(file, 'utf8');
  const route = relative(API_DIR, file).replace(/\/route\.ts$/, '');
  if (GATED_FACTORIES.test(source)) return [{ route, method: '*', checked: true }];

  const parts = source.split(/export (?:async )?function (GET|POST|PUT|PATCH|DELETE)\b/);
  const preamble = parts[0]!;
  const helpers = [...preamble.matchAll(/(?:async )?function (\w+)\([\s\S]*?\n\}/g)];
  const checks: MethodCheck[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    const body = parts[i + 1]!;
    const called = helpers.filter((h) => new RegExp(`\\b${h[1]}\\(`).test(body)).map((h) => h[0]);
    checks.push({ route, method: parts[i]!, checked: ACCESS_CHECKS.test([body, ...called].join('\n')) });
  }
  return checks;
}

describe('API access', () => {
  const all = routeFiles(API_DIR).flatMap(methodsOf);

  it('found the API routes', () => {
    expect(all.length).toBeGreaterThan(150);
  });

  it('checks module or admin access on every method not deliberately open', () => {
    const unchecked = all
      .filter((m) => !m.checked && !(m.route in SIGNED_IN_ONLY))
      .map((m) => `${m.method} /api/${m.route}`);
    expect(unchecked).toEqual([]);
  });

  it('keeps the allowlist honest: every entry is a real route', () => {
    const routes = new Set(all.map((m) => m.route));
    expect(Object.keys(SIGNED_IN_ONLY).filter((r) => !routes.has(r))).toEqual([]);
  });

  it('names only real modules in the access map', () => {
    const slugs = new Set(DEFAULT_MODULES.map((m) => m.slug));
    const unknown = Object.entries(API_ACCESS).flatMap(([key, list]) =>
      list.filter((slug) => !slugs.has(slug)).map((slug) => `${key}: ${slug}`),
    );
    expect(unknown).toEqual([]);
  });
});
