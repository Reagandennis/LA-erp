import { NextRequest, NextResponse } from 'next/server';

import { getAccount } from '@/lib/messaging-accounts';
import { wacliToIngest } from '@/lib/messaging-ingest';
import { ingestMessages } from '@/lib/messaging-repo';
import { webhookSecret } from '@/lib/messaging-webhook-secret';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

/**
 * Live message sink for `wacli sync --follow --webhook`.
 *
 * The sync process posts each incoming WhatsApp message here the moment it
 * arrives, which is what makes the console update without polling.
 *
 * This endpoint is NOT session-authenticated — it is called by a local child
 * process, not a browser — so it is gated on a per-process secret carried in
 * the URL. The secret is generated at boot and only ever handed to the sync
 * processes we spawn ourselves.
 */
export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('token') !== webhookSecret()) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const userId = Number(searchParams.get('user'));
  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  const account = await getAccount(userId, 'whatsapp');
  if (!account) return NextResponse.json({ error: 'not-linked' }, { status: 409 });

  const body = (await request.json().catch(() => null)) as unknown;
  if (!body) return NextResponse.json({ error: 'bad-request' }, { status: 400 });

  // wacli posts either a single message object or an array of them.
  const raw = Array.isArray(body) ? body : [body];
  const batch = raw
    .map((m) => wacliToIngest(m as Parameters<typeof wacliToIngest>[0]))
    .filter((m): m is NonNullable<typeof m> => m !== null);

  const fresh = await ingestMessages(account.id, account.userId, batch);
  return NextResponse.json({ ok: true, ingested: fresh.length });
}
