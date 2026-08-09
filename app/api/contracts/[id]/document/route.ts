import { NextRequest, NextResponse } from 'next/server';

import { getContractDocument, setContractDocument } from '@/lib/contracts';
import { fileResponse } from '@/lib/file-response';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireRequestAuth } from '@/lib/request-auth';
import { getUploadLimitMb, mbToBytes } from '@/lib/upload-limits';
import { userHasModule, userHasRole } from '@/lib/user';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const CONTRACTS_MODULE = 'contract-renewal';

function parseId(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function canAccess(user: Parameters<typeof userHasRole>[0]) {
  return userHasRole(user, ADMIN_ROLE_NAME) || userHasModule(user, CONTRACTS_MODULE);
}

// Serve the stored contract document inline (for viewing/downloading).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;
  if (!canAccess(auth.user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid contract id' }, { status: 400 });

  const doc = await getContractDocument(id);
  if (!doc) return NextResponse.json({ error: 'No document on file' }, { status: 404 });

  return fileResponse({
    content: doc.content,
    mime: doc.mime,
    name: doc.name,
  });
}

// Upload or replace the contract document.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;
  if (!canAccess(auth.user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid contract id' }, { status: 400 });

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

  const item = await setContractDocument(id, {
    name: file.name,
    mime: file.type || 'application/octet-stream',
    size: file.size,
    content: Buffer.from(await file.arrayBuffer()),
  });
  if (item === null) return NextResponse.json({ error: 'Contract not found' }, { status: 404 });

  return NextResponse.json({ item }, { status: 201 });
}
