import { NextRequest, NextResponse } from 'next/server';

import { requireRequestAuth } from '@/lib/request-auth';
import { createDriver } from '@/lib/task-assignment';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  try {
    const item = await createDriver({
      userId: auth.user.id,
      name: String(body.name ?? ''),
      phone: body.phone ?? null,
      licenseNumber: body.licenseNumber ?? null,
      status: typeof body.status === 'string' ? body.status : undefined,
      notes: body.notes ?? null,
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not add driver';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
