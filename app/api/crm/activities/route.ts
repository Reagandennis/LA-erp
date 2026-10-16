import { NextRequest, NextResponse } from 'next/server';

import { API_ACCESS } from '@/lib/api-access';
import { requireModuleRequest } from '@/lib/request-auth';
import { createActivity, listCrmActivities } from '@/lib/crm';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.crm);
  if (response || !auth) return response;

  return NextResponse.json({ activities: await listCrmActivities() });
}

export async function POST(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.crm);
  if (response || !auth) return response;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || typeof body.customerId !== 'number') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const result = await createActivity(auth.user.id, {
    customerId: body.customerId,
    dealId: typeof body.dealId === 'number' ? body.dealId : null,
    contactId: typeof body.contactId === 'number' ? body.contactId : null,
    type: String(body.type ?? 'note'),
    summary: String(body.summary ?? ''),
    occurredAt: typeof body.occurredAt === 'string' ? body.occurredAt : null,
  });

  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ activity: result }, { status: 201 });
}
