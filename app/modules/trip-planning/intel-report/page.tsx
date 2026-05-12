import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, FileText, MapPinned, ShieldCheck } from 'lucide-react';

import { getServerAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export default async function IntelReportPage() {
  const auth = await getServerAuth();

  if (!auth) {
    redirect('/auth/login');
  }

  const trips = await prisma.trip.findMany({
    where: { userId: auth.user.id },
    include: {
      intelReports: {
        orderBy: { version: 'desc' },
        take: 1,
      },
    },
    orderBy: { updatedAt: 'desc' },
  });

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

          <header className="flex flex-col gap-4 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-3xl font-black tracking-tight text-gray-900 lg:text-4xl">Intel Reports</h1>
              <p className="mt-2 text-sm text-gray-600">
                Each new trip now gets an automatic draft Intel Report. Open a trip report to review the generated sections and complete the venue advance details.
              </p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-2xl bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700">
              <ShieldCheck className="h-4 w-4" />
              Auto-generated on trip creation
            </div>
          </header>
        </div>

        {trips.length === 0 ? (
          <section className="rounded-3xl border border-dashed border-gray-300 bg-white p-12 text-center shadow-sm">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gray-50 text-blue-600">
              <FileText className="h-8 w-8" />
            </div>
            <h2 className="mt-4 text-lg font-black text-gray-900">No trips yet</h2>
            <p className="mt-2 text-sm text-gray-500">
              Create a trip first and the system will automatically prepare an Intel Report draft.
            </p>
          </section>
        ) : (
          <section className="grid gap-6 lg:grid-cols-2">
            {trips.map((trip) => {
              const report = trip.intelReports[0] ?? null;
              return (
                <article
                  key={trip.id}
                  className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-600">
                        {report ? report.generationStatus : 'ready to generate'}
                      </p>
                      <h2 className="mt-2 text-2xl font-black text-gray-900">{trip.title}</h2>
                      <p className="mt-2 text-sm text-gray-600">
                        {trip.destination || 'Destination pending confirmation'}
                      </p>
                    </div>
                    <span className="inline-flex w-fit rounded-full bg-gray-50 px-3 py-1 text-xs font-bold text-gray-600">
                      {report?.overallRiskLevel ?? 'Pending Review'}
                    </span>
                  </div>

                  <div className="mt-5 flex flex-wrap gap-4 text-sm text-gray-600">
                    <div className="inline-flex items-center gap-2">
                      <MapPinned className="h-4 w-4" />
                      {trip.destination || 'No destination'}
                    </div>
                    <div className="inline-flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      {report ? 'Draft report available' : 'Draft created on first open'}
                    </div>
                  </div>

                  <div className="mt-6 flex gap-3">
                    <Link
                      href={`/modules/trip-planning/${trip.id}/intel-report`}
                      className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-blue-700"
                    >
                      <ShieldCheck className="h-4 w-4" />
                      Open Intel Report
                    </Link>
                    <Link
                      href={`/modules/trip-planning/${trip.id}`}
                      className="inline-flex items-center gap-2 rounded-2xl border border-gray-200 px-4 py-2.5 text-sm font-bold text-gray-700 transition hover:bg-gray-50"
                    >
                      View Trip
                    </Link>
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </div>
    </main>
  );
}
