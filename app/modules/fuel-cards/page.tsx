import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { listFleetVehicles } from '@/lib/fleet-server';
import { listFuelCards } from '@/lib/fuel-cards-server';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasModule, userHasRole } from '@/lib/user';

import FuelCardsClient from './fuel-cards-client';

export const dynamic = 'force-dynamic';

export default async function FuelCardsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const auth = await getServerAuth();
  if (!auth) {
    redirect('/auth/login');
  }

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  if (!isAdmin && !userHasModule(auth.user, 'fuel-cards')) {
    redirect('/dashboard');
  }

  const [cards, vehicles, { card }] = await Promise.all([listFuelCards(), listFleetVehicles({ internalOnly: true }), searchParams]);
  // A bell alert or a Car Fuel chip opens straight on that card's statement.
  const requested = Number(Array.isArray(card) ? card[0] : card);
  const initialCardId = cards.some((c) => c.id === requested) ? requested : (cards.find((c) => c.active)?.id ?? null);

  return (
    <FuelCardsClient
      initialCards={cards}
      initialCardId={initialCardId}
      vehicles={vehicles}
      canOpenCarFuel={isAdmin || userHasModule(auth.user, 'car-fuel')}
    />
  );
}
