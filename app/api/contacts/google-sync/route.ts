import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { recordAuditEvent } from '@/lib/audit';
import { listContacts } from '@/lib/contacts';
import { syncGoogleContacts } from '@/lib/google-contacts';
import { enforceRateLimit } from '@/lib/rate-limit';
import { requireRequestAuth } from '@/lib/request-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const bodySchema = z.object({
  accessToken: z.string().min(1, 'A Google access token is required'),
});

export async function POST(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request body' },
      { status: 400 },
    );
  }

  // Each run can page through thousands of records; keep it from being hammered.
  const rateLimit = await enforceRateLimit({
    scope: 'contacts.google-sync',
    key: String(auth.user.id),
    limit: 5,
    windowMs: 10 * 60 * 1000,
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error: 'Too many sync attempts. Try again shortly.',
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    );
  }

  try {
    const result = await syncGoogleContacts(auth.user.id, parsed.data.accessToken);

    await recordAuditEvent({
      action: 'contacts.google.synced',
      entityType: 'contact',
      actorUserId: auth.user.id,
      metadata: {
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
        total: result.total,
        truncated: result.truncated,
      },
      request,
    });

    // Return the refreshed directory so the client doesn't need a second round trip.
    return NextResponse.json({ result, contacts: await listContacts() });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Could not sync Google contacts';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
