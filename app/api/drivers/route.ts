import { NextRequest, NextResponse } from 'next/server';

import { requireAdminRequest, requireRequestAuth } from '@/lib/request-auth';
import { computeStats, createDriverLicense, listDriverLicenses } from '@/lib/drivers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024; // 10 MB

export async function GET(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const items = await listDriverLicenses();
  return NextResponse.json({ items, stats: computeStats(items) });
}

export async function POST(request: NextRequest) {
  const { auth, response } = await requireAdminRequest(request);
  if (response || !auth) return response;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const driverName = String(formData.get('driverName') ?? '');
  const licenseNumber = String(formData.get('licenseNumber') ?? '');
  const category = String(formData.get('category') ?? 'Class A');
  const expiryRaw = String(formData.get('expiryDate') ?? '');
  const lastVerifiedRaw = String(formData.get('lastVerified') ?? '');
  const notes = String(formData.get('notes') ?? '');

  if (!driverName.trim() || !licenseNumber.trim()) {
    return NextResponse.json({ error: 'Driver name and license number are required' }, { status: 400 });
  }
  const expiryDate = new Date(expiryRaw);
  if (Number.isNaN(expiryDate.getTime())) {
    return NextResponse.json({ error: 'A valid expiry date is required' }, { status: 400 });
  }
  const lastVerified = lastVerifiedRaw ? new Date(lastVerifiedRaw) : null;

  let document: { name: string; mime: string; size: number; content: Buffer } | null = null;
  const file = formData.get('document');
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_DOCUMENT_BYTES) {
      return NextResponse.json({ error: 'Document exceeds the 10 MB limit' }, { status: 400 });
    }
    document = {
      name: file.name,
      mime: file.type || 'application/octet-stream',
      size: file.size,
      content: Buffer.from(await file.arrayBuffer()),
    };
  }

  try {
    const item = await createDriverLicense({
      userId: auth.user.id,
      driverName,
      licenseNumber,
      category,
      expiryDate,
      lastVerified: lastVerified && !Number.isNaN(lastVerified.getTime()) ? lastVerified : null,
      notes,
      document,
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not add driver';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
