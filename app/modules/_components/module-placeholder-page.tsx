import Link from 'next/link';

interface ModulePlaceholderPageProps {
  title: string;
  category: string;
  description: string;
}

export default function ModulePlaceholderPage({
  title,
  category,
  description,
}: ModulePlaceholderPageProps) {
  return (
    <main className="min-h-full bg-gray-50/50 p-8 lg:p-12">
      <div className="mx-auto max-w-5xl space-y-8">
        <section className="overflow-hidden rounded-[2rem] bg-white shadow-sm ring-1 ring-gray-200">
          <div className="border-b border-gray-100 bg-gray-50/80 px-8 py-6">
            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-gray-500">
              {category}
            </p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-gray-900">
              {title}
            </h1>
          </div>

          <div className="grid gap-8 px-8 py-10 lg:grid-cols-[1.3fr_0.7fr]">
            <div className="space-y-6">
              <div className="rounded-[1.75rem] border border-dashed border-gray-300 bg-gray-50 p-8">
                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-emerald-700">
                  In Progress
                </p>
                <h2 className="mt-3 text-2xl font-black tracking-tight text-gray-900">
                  This module is back in the platform.
                </h2>
                <p className="mt-3 max-w-2xl text-sm leading-7 text-gray-600">
                  {description}
                </p>
                <p className="mt-4 text-sm leading-7 text-gray-600">
                  Use this page as the placeholder entry point while you build the
                  actual workflow, data view, and actions for this module.
                </p>
              </div>

              <div className="rounded-[1.75rem] bg-gray-900 p-8 text-white">
                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-emerald-300">
                  Suggested Next Step
                </p>
                <p className="mt-3 text-sm leading-7 text-white/70">
                  Replace this placeholder with the real screen for this module when
                  you are ready. The route is now stable, so you can build it file by
                  file without depending on the broken dynamic fallback.
                </p>
              </div>
            </div>

            <aside className="rounded-[1.75rem] border border-gray-200 bg-white p-8">
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-gray-500">
                Quick Actions
              </p>
              <div className="mt-5 space-y-3">
                <Link
                  href="/dashboard"
                  className="flex items-center justify-center rounded-2xl bg-gray-900 px-4 py-3 text-sm font-bold text-white transition hover:bg-black"
                >
                  Back To Dashboard
                </Link>
                <Link
                  href="/admin"
                  className="flex items-center justify-center rounded-2xl border border-gray-200 px-4 py-3 text-sm font-bold text-gray-700 transition hover:bg-gray-50"
                >
                  Open Admin
                </Link>
              </div>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}
