import { NextRequest, NextResponse } from 'next/server';

import { API_ACCESS } from '@/lib/api-access';
import { enforceRateLimit } from '@/lib/rate-limit';
import { requireModuleRequest } from '@/lib/request-auth';
import { TICKET_MAX_BYTES, isTicketMime, readTicket } from '@/lib/ticket-reader';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * The flight form's "Read from e-ticket": one file (PDF or photo) in a
 * multipart body → what is printed on it (see lib/ticket-reader). Nothing
 * is stored here; the form attaches the file to the event when it saves.
 */
export async function POST(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.trips);
  if (response || !auth) return response;

  // Each read is a paid model call on a whole document.
  const rateLimit = await enforceRateLimit({ scope: 'ticket.read', key: `${auth.user.id}`, limit: 10, windowMs: 60 * 1000 });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many tickets in a minute. Slow down and try again.', retryAfterSeconds: rateLimit.retryAfterSeconds },
      { status: 429 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Send the ticket as a file.' }, { status: 400 });
  }
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'Send the ticket as a file.' }, { status: 400 });
  }
  if (file.size > TICKET_MAX_BYTES) {
    return NextResponse.json({ error: 'The ticket is larger than 10 MB.' }, { status: 400 });
  }
  const mimeType = file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : '');
  if (!isTicketMime(mimeType)) {
    return NextResponse.json({ error: 'A ticket is a PDF or a photo (JPEG, PNG or WebP).' }, { status: 400 });
  }

  const result = await readTicket({ content: Buffer.from(await file.arrayBuffer()), mimeType, userId: auth.user.id });
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ reading: result.reading });
}
