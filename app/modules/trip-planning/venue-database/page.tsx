import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Building2, MapPin, Phone, ArrowLeft } from 'lucide-react';
import { getServerAuth } from '@/lib/auth';

const sampleVenues = [
  {
    name: 'Grand Horizon Hotel',
    location: 'Nairobi, Kenya',
    contact: '+254 700 000 001',
    type: 'Hotel',
  },
  {
    name: 'Savannah Conference Centre',
    location: 'Mombasa, Kenya',
    contact: '+254 700 000 002',
    type: 'Conference',
  },
  {
    name: 'Lakeside Retreat',
    location: 'Naivasha, Kenya',
    contact: '+254 700 000 003',
    type: 'Retreat',
  },
];

export default async function VenueDatabasePage() {
  const auth = await getServerAuth();

  if (!auth) {
    redirect('/auth/login');
  }

  return (
    <main className="min-h-full bg-gray-50/60 p-6 lg:p-10">
      <div className="mx-auto max-w-7xl space-y-8">
        <div className="flex flex-col gap-4">
          <Link
            href="/modules/trip-planning"
            className="inline-flex w-fit items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-600 transition hover:border-gray-300 hover:text-gray-900"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Trip Planning
          </Link>

          <header>
            <h1 className="text-3xl font-black tracking-tight text-gray-900 lg:text-4xl">
              Venue Database
            </h1>
            <p className="mt-2 text-sm text-gray-600">
              Review commonly used venues for accommodation, meetings, and trip events.
            </p>
          </header>
        </div>

        <section className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {sampleVenues.map((venue) => (
            <article
              key={venue.name}
              className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-600">
                    {venue.type}
                  </p>
                  <h2 className="mt-2 text-xl font-black text-gray-900">{venue.name}</h2>
                </div>
                <div className="rounded-2xl bg-blue-50 p-3 text-blue-600">
                  <Building2 className="h-5 w-5" />
                </div>
              </div>

              <div className="mt-6 space-y-3 text-sm text-gray-600">
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  <span>{venue.location}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4" />
                  <span>{venue.contact}</span>
                </div>
              </div>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
