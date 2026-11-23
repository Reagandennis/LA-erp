import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { resolveDevicePrincipal } from '@/lib/work-devices';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  context: z.enum(['login', 'session']).default('login'),
  facts: z.record(z.string().max(40), z.union([z.string().max(300), z.boolean(), z.null()])),
});

/**
 * Records why a browser could not run the device check (no passkey support on
 * the page), so an administrator can diagnose it from the server log instead of
 * relaying screenshots. Only reachable mid-sign-in or signed in.
 */
export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const principal =
    (await resolveDevicePrincipal(request, parsed.data.context)) ??
    (await resolveDevicePrincipal(request, parsed.data.context === 'login' ? 'session' : 'login'));
  if (!principal) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  console.warn(
    '[device-check] unsupported',
    JSON.stringify({ userId: principal.user.id, via: principal.via, ...parsed.data.facts }),
  );
  return NextResponse.json({ ok: true });
}
