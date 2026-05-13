import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import {
  clearOrganizationLogo,
  getOrganizationLogo,
  setOrganizationLogo,
} from '@/lib/organization';
import { requireAdminRequest, requireRequestAuth } from '@/lib/request-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];
const MAX_BYTES = 1_000_000; // 1MB

// Anyone authenticated can read the logo (used in PDF + branding card)
export async function GET(request: NextRequest) {
  const { response } = await requireRequestAuth(request);
  if (response) return response;

  const logo = await getOrganizationLogo();
  if (!logo) return new NextResponse('Not found', { status: 404 });

  return new NextResponse(new Uint8Array(logo.buffer), {
    status: 200,
    headers: {
      'Content-Type': logo.mimeType,
      'Cache-Control': 'private, max-age=60',
    },
  });
}

export async function POST(request: NextRequest) {
  const { auth, response } = await requireAdminRequest(request);
  if (response || !auth) return response;

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
  const settings = await setOrganizationLogo(buffer, file.type, auth.user.id);

  await recordAuditEvent({
    action: 'admin.organization.logo.updated',
    entityType: 'organization',
    actorUserId: auth.user.id,
    metadata: { mimeType: file.type, size: file.size },
    request,
  });

  return NextResponse.json({ settings });
}

export async function DELETE(request: NextRequest) {
  const { auth, response } = await requireAdminRequest(request);
  if (response || !auth) return response;

  const settings = await clearOrganizationLogo(auth.user.id);

  await recordAuditEvent({
    action: 'admin.organization.logo.cleared',
    entityType: 'organization',
    actorUserId: auth.user.id,
    request,
  });

  return NextResponse.json({ settings });
}
