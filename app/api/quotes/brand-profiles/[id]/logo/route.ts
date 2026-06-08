import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import {
  clearBrandProfileLogo,
  getBrandProfileLogo,
  setBrandProfileLogo,
} from '@/lib/brand-profiles';
import { requireAdminRequest, requireRequestAuth } from '@/lib/request-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];
const MAX_BYTES = 1_000_000; // 1MB

function parseId(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

// Anyone authenticated can fetch the logo (used by PDF + the builder preview)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { response } = await requireRequestAuth(request);
  if (response) return response;

  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const logo = await getBrandProfileLogo(id);
  if (!logo) return new NextResponse('Not found', { status: 404 });

  return new NextResponse(new Uint8Array(logo.buffer), {
    status: 200,
    headers: {
      'Content-Type': logo.mimeType,
      'Cache-Control': 'private, max-age=60',
    },
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { auth, response } = await requireAdminRequest(request);
  if (response || !auth) return response;

  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const formData = await request.formData().catch(() => null);
  const file = formData?.get('logo');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Upload a logo file in the "logo" field' }, { status: 400 });
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: `Logo must be one of: ${ALLOWED_TYPES.join(', ')}` },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'Logo must be 1MB or smaller' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const profile = await setBrandProfileLogo(id, buffer, file.type);

  await recordAuditEvent({
    action: 'quote.brand-profile.logo.updated',
    entityType: 'brand-profile',
    entityId: String(id),
    actorUserId: auth.user.id,
    metadata: { mimeType: file.type, size: file.size },
    request,
  });

  return NextResponse.json({ profile });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { auth, response } = await requireAdminRequest(request);
  if (response || !auth) return response;

  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const profile = await clearBrandProfileLogo(id);

  await recordAuditEvent({
    action: 'quote.brand-profile.logo.cleared',
    entityType: 'brand-profile',
    entityId: String(id),
    actorUserId: auth.user.id,
    request,
  });

  return NextResponse.json({ profile });
}
