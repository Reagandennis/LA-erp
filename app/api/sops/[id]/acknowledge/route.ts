import { NextRequest, NextResponse } from 'next/server';

import { API_ACCESS } from '@/lib/api-access';
import { requireModuleRequest } from '@/lib/request-auth';
import { acknowledgeSop } from '@/lib/sops';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseId(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.sops);
  if (response || !auth) return response;

  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid SOP id' }, { status: 400 });

  const result = await acknowledgeSop(id, auth.user.id);
  if (!result) return NextResponse.json({ error: 'SOP not found' }, { status: 404 });
  return NextResponse.json(result, { status: 201 });
}
