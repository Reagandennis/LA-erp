import { NextRequest, NextResponse } from 'next/server';

import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireRequestAuth } from '@/lib/request-auth';
import { userHasModule, userHasRole } from '@/lib/user';
import { syncInvoiceToWave, syncQuoteToWave } from '@/lib/wave';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** Manually (re-)push an invoice or quote to Wave. Admin / invoices-review only. */
export async function POST(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;
  if (!userHasRole(auth.user, ADMIN_ROLE_NAME) && !userHasModule(auth.user, 'invoices-review')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { type?: string; id?: number } | null;
  const type = body?.type;
  const id = Number(body?.id);
  if ((type !== 'invoice' && type !== 'quote') || !Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "type ('invoice'|'quote') and id are required" }, { status: 400 });
  }

  const result = type === 'invoice' ? await syncInvoiceToWave(id) : await syncQuoteToWave(id);
  const httpStatus = result.status === 'failed' ? 502 : 200;
  return NextResponse.json({ result }, { status: httpStatus });
}
