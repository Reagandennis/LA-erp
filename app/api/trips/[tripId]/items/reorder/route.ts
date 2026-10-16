import { NextRequest, NextResponse } from 'next/server';

import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { API_ACCESS } from '@/lib/api-access';
import { requireModuleRequest } from '@/lib/request-auth';
import { reorderTripItems } from '@/lib/trips';
import { userHasRole } from '@/lib/user';
import { tripItemReorderSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseId(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tripId: string }> },
) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.trips);
  if (response || !auth) return response;

  const { tripId: raw } = await params;
  const tripId = parseId(raw);
  if (!tripId) return NextResponse.json({ error: 'Invalid trip id' }, { status: 400 });

  const body = await request.json().catch(() => null);
  const validation = tripItemReorderSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: validation.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  const result = await reorderTripItems({
    tripId,
    userId: auth.user.id,
    isAdmin,
    days: validation.data.days,
  });

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
  }

  // No audit event: a drag is a layout tweak, and one row per drop would drown
  // the audit log. The item PATCH/DELETE paths still record their own.
  return NextResponse.json(result);
}
