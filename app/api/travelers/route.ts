import { NextRequest, NextResponse } from 'next/server';

import { listCustomerOptions } from '@/lib/contacts';
import { requireAdminRequest, requireModuleRequest } from '@/lib/request-auth';
import { createTraveler, listTravelers, searchTravelers, travelerStats } from '@/lib/travelers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const TRAVELERS_MODULE = 'travelers';

const SEARCH_PARAMS = ['q', 'risk', 'status', 'page', 'pageSize'] as const;

export async function GET(request: NextRequest) {
  // Travellers carry passport, date-of-birth and medical detail, so this is
  // gated on the module grant rather than on being logged in.
  const { auth, response } = await requireModuleRequest(request, TRAVELERS_MODULE);
  if (response || !auth) return response;

  const params = request.nextUrl.searchParams;
  if (SEARCH_PARAMS.some((key) => params.has(key))) {
    // The directory: one page, filtered and searched in the database, with
    // the stat tiles' counts alongside so a refresh is a single request.
    const [result, stats] = await Promise.all([
      searchTravelers({
        q: params.get('q'),
        risk: params.get('risk'),
        status: params.get('status'),
        page: Number(params.get('page') ?? 1) || 1,
        pageSize: Number(params.get('pageSize')) || null,
      }),
      travelerStats(),
    ]);
    return NextResponse.json({ ...result, stats });
  }

  const [items, customers] = await Promise.all([listTravelers(), listCustomerOptions()]);
  return NextResponse.json({ items, customers });
}

export async function POST(request: NextRequest) {
  const { auth, response } = await requireAdminRequest(request);
  if (response || !auth) return response;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  try {
    const item = await createTraveler({
      createdById: auth.user.id,
      name: String(body.name ?? ''),
      customerId: typeof body.customerId === 'number' ? body.customerId : null,
      email: body.email ?? null,
      phone: body.phone ?? null,
      nationality: body.nationality ?? null,
      dateOfBirth: typeof body.dateOfBirth === 'string' ? body.dateOfBirth : null,
      passportNumber: body.passportNumber ?? null,
      passportExpiry: typeof body.passportExpiry === 'string' ? body.passportExpiry : null,
      status: typeof body.status === 'string' ? body.status : undefined,
      riskLevel: typeof body.riskLevel === 'string' ? body.riskLevel : undefined,
      dietaryNotes: body.dietaryNotes ?? null,
      medicalNotes: body.medicalNotes ?? null,
      emergencyContactName: body.emergencyContactName ?? null,
      emergencyContactPhone: body.emergencyContactPhone ?? null,
      notes: body.notes ?? null,
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not add the traveller';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
