import { NextRequest, NextResponse } from 'next/server';

import { API_ACCESS } from '@/lib/api-access';
import { recordAuditEvent } from '@/lib/audit';
import { requireModuleRequest } from '@/lib/request-auth';
import { vendorCreateSchema } from '@/lib/validation';
import { createVendor, getVendorRegister } from '@/lib/vendors';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** The vendor register: every vendor with its catalog, and whose each vehicle and person is. */
export async function GET(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.vendors);
  if (response || !auth) return response;
  return NextResponse.json({ register: await getVendorRegister() });
}

export async function POST(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.vendors);
  if (response || !auth) return response;

  const body = await request.json().catch(() => null);
  const validation = vendorCreateSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json({ error: validation.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  const result = await createVendor(auth.user.id, validation.data);
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });

  await recordAuditEvent({
    action: 'vendor.created',
    entityType: 'vendor',
    entityId: result.vendor ? String(result.vendor.id) : null,
    actorUserId: auth.user.id,
    metadata: { name: validation.data.name, status: validation.data.status, internal: validation.data.internal },
    request,
  });

  return NextResponse.json(result, { status: 201 });
}
