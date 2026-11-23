import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { listFleetVehicles } from '@/lib/fleet-server';
import { listParkingCards } from '@/lib/parking-cards-server';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasModule, userHasRole } from '@/lib/user';

import ParkingCardsClient from './parking-cards-client';

export const dynamic = 'force-dynamic';

export default async function ParkingCardsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const auth = await getServerAuth();
  if (!auth) redirect('/auth/login');
  if (!userHasRole(auth.user, ADMIN_ROLE_NAME) && !userHasModule(auth.user, 'parking-cards')) redirect('/dashboard');

  const [cards, vehicles, { card }] = await Promise.all([listParkingCards(), listFleetVehicles({ internalOnly: true }), searchParams]);
  const requested = Number(Array.isArray(card) ? card[0] : card);
  const initialCardId = cards.some((c) => c.id === requested) ? requested : (cards.find((c) => c.active)?.id ?? null);

  return <ParkingCardsClient initialCards={cards} initialCardId={initialCardId} vehicles={vehicles} />;
}
