import { NextRequest, NextResponse } from 'next/server';

import { requireRequestAuth } from '@/lib/request-auth';
import { getDriverLicenseDocument, setDriverLicenseDocument } from '@/lib/drivers';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { getUploadLimitMb, mbToBytes } from '@/lib/upload-limits';
import { userHasModule, userHasRole } from '@/lib/user';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const DRIVERS_MODULE = 'drivers-license-expiry';

function parseId(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Serve the stored license document inline (for viewing/downloading).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ licenseId: string }> },
) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;
  if (!userHasRole(auth.user, ADMIN_ROLE_NAME) && !userHasModule(auth.user, DRIVERS_MODULE)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { licenseId: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid license id' }, { status: 400 });

  const doc = await getDriverLicenseDocument(id);
  if (!doc) return NextResponse.json({ error: 'No document on file' }, { status: 404 });

  const body = new Uint8Array(doc.content);
  return new Response(body, {
    headers: {
      'Content-Type': doc.mime,
      'Content-Disposition': `inline; filename="${doc.name.replace(/"/g, '')}"`,
      'Content-Length': String(body.byteLength),
      'Cache-Control': 'private, no-store',
    },
  });
}

// Upload or replace the license document.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ licenseId: string }> },
) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;
  if (!userHasRole(auth.user, ADMIN_ROLE_NAME) && !userHasModule(auth.user, DRIVERS_MODULE)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { licenseId: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid license id' }, { status: 400 });

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const file = formData.get('document');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'No document uploaded' }, { status: 400 });
  }
  const maxDocumentMb = await getUploadLimitMb('documentMb');
  if (file.size > mbToBytes(maxDocumentMb)) {
    return NextResponse.json({ error: `Document exceeds the ${maxDocumentMb} MB limit` }, { status: 400 });
  }

  const item = await setDriverLicenseDocument(id, {
    name: file.name,
    mime: file.type || 'application/octet-stream',
    size: file.size,
    content: Buffer.from(await file.arrayBuffer()),
  });
  if (item === null) return NextResponse.json({ error: 'Driver not found' }, { status: 404 });

  return NextResponse.json({ item }, { status: 201 });
}
