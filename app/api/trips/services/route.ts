import { NextRequest, NextResponse } from 'next/server';

import { API_ACCESS } from '@/lib/api-access';
import { listProducts } from '@/lib/products';
import { requireModuleRequest } from '@/lib/request-auth';
import type { ServiceOption } from '@/lib/service-catalog';
import { canSeeTripCosts } from '@/lib/trip-costs';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * The services a trip event can sell, from Products & Services: active ones
 * only. Fetched when the picker first opens, so the itinerary page doesn't
 * carry the catalog on every visit. Prices go only to people who see trip costs.
 */
export async function GET(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.trips);
  if (response || !auth) return response;

  const withPrices = canSeeTripCosts(auth.user);
  const services: ServiceOption[] = (await listProducts()).map((product) => ({
    id: product.id,
    code: product.sku,
    name: product.name,
    category: product.category,
    subCategory: product.subCategory,
    serviceClass: product.serviceClass,
    tier: product.tier,
    country: product.country,
    location: product.location,
    unitOfMeasure: product.unitOfMeasure,
    ...(withPrices ? { defaultUnitPrice: product.defaultUnitPrice, currency: product.currency } : {}),
  }));

  return NextResponse.json({ services });
}
