import Image from 'next/image';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ArrowLeft } from 'lucide-react';
import TripHeader from '@/app/modules/trip-planning/_components/TripHeader';
import Timeline from '@/app/modules/trip-planning/_components/Timeline';

export default async function TripSummaryPage({ params }: { params: Promise<{ tripId: string }> }) {
  const auth = await getServerAuth();

  if (!auth) {
    redirect('/auth/login');
  }

  const { tripId: rawTripId } = await params;
  const tripId = parseInt(rawTripId, 10);

  if (isNaN(tripId)) {
    redirect('/modules/trip-planning');
  }

  const trip = await prisma.trip.findFirst({
    where: { id: tripId, userId: auth.user.id },
    include: {
      itineraryItems: {
        orderBy: [{ dayNumber: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
      },
    },
  }) as any;

  if (!trip) {
    redirect('/modules/trip-planning');
  }

  return (
    <main className="min-h-full bg-[#f8fafc] px-6 py-8 lg:px-12 lg:py-10">
      <div className="mx-auto max-w-6xl">
        <Link
          href="/modules/trip-planning"
          className="mb-8 inline-flex items-center gap-3 text-sm font-black text-blue-600 uppercase tracking-widest hover:text-blue-800 transition-all"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Trips
        </Link>

        <TripHeader trip={trip} />

        <div className="mt-12">
          <Timeline 
            tripId={trip.id} 
            status={trip.status}
            initialItems={trip.itineraryItems.map((item: any) => ({
              ...item,
              startTime: item.startTime?.toISOString() ?? null,
              endTime: item.endTime?.toISOString() ?? null,
            }))} 
          />
        </div>
      </div>
    </main>
  );
}
