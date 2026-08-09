import { NextRequest, NextResponse } from 'next/server';

import { computeStats, createContract, listContracts } from '@/lib/contracts';
import { requireAdminRequest, requireRequestAuth } from '@/lib/request-auth';
import { getUploadLimitMb, mbToBytes } from '@/lib/upload-limits';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const items = await listContracts();
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

  const reference = String(formData.get('reference') ?? '');
  const counterpartyName = String(formData.get('counterpartyName') ?? '');
  const email = String(formData.get('email') ?? '');
  const department = String(formData.get('department') ?? '');
  const type = String(formData.get('type') ?? 'Fixed Term');
  const status = String(formData.get('status') ?? 'Active');
  const startRaw = String(formData.get('startDate') ?? '');
  const endRaw = String(formData.get('endDate') ?? '');
  const valueRaw = String(formData.get('value') ?? '');
  const currency = String(formData.get('currency') ?? 'USD');
  const notes = String(formData.get('notes') ?? '');

  if (!reference.trim() || !counterpartyName.trim()) {
    return NextResponse.json({ error: 'Reference and counterparty name are required' }, { status: 400 });
  }
  const startDate = new Date(startRaw);
  const endDate = new Date(endRaw);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return NextResponse.json({ error: 'Valid start and end dates are required' }, { status: 400 });
  }

  let document: { name: string; mime: string; size: number; content: Buffer } | null = null;
  const file = formData.get('document');
  if (file instanceof File && file.size > 0) {
    const maxDocumentMb = await getUploadLimitMb('documentMb');
    if (file.size > mbToBytes(maxDocumentMb)) {
      return NextResponse.json({ error: `Document exceeds the ${maxDocumentMb} MB limit` }, { status: 400 });
    }
    document = {
      name: file.name,
      mime: file.type || 'application/octet-stream',
      size: file.size,
      content: Buffer.from(await file.arrayBuffer()),
    };
  }

  try {
    const item = await createContract({
      userId: auth.user.id,
      reference,
      counterpartyName,
      email: email || null,
      department: department || null,
      type,
      status,
      startDate,
      endDate,
      value: valueRaw.trim() ? Number(valueRaw) : null,
      currency,
      notes: notes || null,
      document,
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not create contract';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
