import { NextRequest, NextResponse } from 'next/server';

import { requireAdminRequest, requireRequestAuth } from '@/lib/request-auth';
import { deleteSop, getSop, updateSop } from '@/lib/sops';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseId(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid SOP id' }, { status: 400 });

  const item = await getSop(id, auth.user.id);
  if (!item) return NextResponse.json({ error: 'SOP not found' }, { status: 404 });
  return NextResponse.json({ item });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, response } = await requireAdminRequest(request);
  if (response || !auth) return response;

  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid SOP id' }, { status: 400 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const patch: {
    code?: string;
    title?: string;
    category?: string;
    status?: string;
    version?: string;
    ownerName?: string | null;
    description?: string | null;
    steps?: unknown;
    effectiveDate?: string | null;
    reviewDate?: string | null;
    revisionSummary?: string;
  } = {};
  if (typeof body.code === 'string') patch.code = body.code;
  if (typeof body.title === 'string') patch.title = body.title;
  if (typeof body.category === 'string') patch.category = body.category;
  if (typeof body.status === 'string') patch.status = body.status;
  if (typeof body.version === 'string') patch.version = body.version;
  if (typeof body.ownerName === 'string' || body.ownerName === null) patch.ownerName = body.ownerName;
  if (typeof body.description === 'string' || body.description === null) patch.description = body.description;
  if (Array.isArray(body.steps)) patch.steps = body.steps;
  if (typeof body.effectiveDate === 'string' || body.effectiveDate === null) patch.effectiveDate = body.effectiveDate;
  if (typeof body.reviewDate === 'string' || body.reviewDate === null) patch.reviewDate = body.reviewDate;
  if (typeof body.revisionSummary === 'string') patch.revisionSummary = body.revisionSummary;

  try {
    const item = await updateSop(id, auth.user.id, patch);
    if (item === null) return NextResponse.json({ error: 'SOP not found' }, { status: 404 });
    return NextResponse.json({ item });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not update SOP';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, response } = await requireAdminRequest(request);
  if (response || !auth) return response;

  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid SOP id' }, { status: 400 });

  const ok = await deleteSop(id);
  if (!ok) return NextResponse.json({ error: 'SOP not found' }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
