import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import CreateTripForm from './_components/CreateTripForm';
import { Plane, Calendar, MapPin } from 'lucide-react';

export default async function TripPlanningPage() {
  const auth = await getServerAuth();

  if (!auth) {
    redirect('/auth/login');
  }

  const trips = await prisma.trip.findMany({
    where: { userId: auth.user.id },
    orderBy: { updatedAt: 'desc' },
  });

  return (
    <main className="min-h-full bg-gray-50/60 p-6 lg:p-10">
      <div className="mx-auto max-w-7xl space-y-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-black tracking-tight text-gray-900 lg:text-4xl">
              Trip Planning
            </h1>
            <p className="mt-2 text-sm text-gray-600">
              Manage your upcoming trips and itineraries.
            </p>
          </div>
          <CreateTripForm />
        </header>

        {trips.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-gray-300 bg-white p-12 text-center shadow-sm">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gray-50">
              <Plane className="h-8 w-8 text-gray-400" />
            </div>
            <h3 className="mt-4 text-lg font-black text-gray-900">No trips yet</h3>
            <p className="mt-2 text-sm text-gray-500">
              Get started by creating your first trip itinerary.
            </p>
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {trips.map((trip) => (
              <Link
                key={trip.id}
                href={`/modules/trip-planning/${trip.id}`}
                className="group relative flex flex-col justify-between overflow-hidden rounded-3xl border border-gray-200 bg-white p-6 shadow-sm transition hover:border-gray-300 hover:shadow-md"
              >
                <div>
                  <div className="flex items-start justify-between gap-4">
                    <h3 className="text-xl font-black text-gray-900 group-hover:text-blue-600 transition-colors">
                      {trip.title}
                    </h3>
                    <span className="inline-flex rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                      {trip.status}
                    </span>
                  </div>
                  
                  <div className="mt-4 space-y-2">
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      <MapPin className="h-4 w-4" />
                      {trip.destination || 'Destination TBD'}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      <Calendar className="h-4 w-4" />
                      {trip.startDate ? new Date(trip.startDate).toLocaleDateString() : 'TBD'} 
                      {' - '}
                      {trip.endDate ? new Date(trip.endDate).toLocaleDateString() : 'TBD'}
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
