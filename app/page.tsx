import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen bg-stone-950 text-stone-100">
      <nav className="border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-emerald-300 mb-2">
              Operations Platform
            </p>
            <div className="font-bold text-2xl">LA-ERP</div>
          </div>
          <div className="space-x-4">
            <Link
              href="/auth/login"
              className="px-4 py-2 text-stone-200 hover:text-white font-medium transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/auth/signup"
              className="px-4 py-2 bg-emerald-500 text-stone-950 rounded-xl hover:bg-emerald-400 transition-colors font-semibold"
            >
              Access policy
            </Link>
          </div>
        </div>
      </nav>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 md:py-32">
        <div className="grid lg:grid-cols-[1.2fr_0.8fr] gap-12 items-center">
          <div>
            <p className="text-sm uppercase tracking-[0.35em] text-emerald-300 mb-6">
              Administrator-managed ERP access
            </p>
            <h1 className="text-5xl md:text-7xl font-bold leading-tight mb-6">
              Tight control over users, roles, and operational access.
            </h1>
            <p className="text-xl text-stone-300 mb-10 leading-8 max-w-3xl">
              LA-ERP is built for organizations that want revocable sessions,
              server-enforced authorization, and auditable admin actions by
              default.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Link
                href="/auth/login"
                className="px-8 py-4 bg-emerald-500 text-stone-950 rounded-2xl hover:bg-emerald-400 transition-colors font-semibold text-lg"
              >
                Sign in
              </Link>
              <Link
                href="/auth/signup"
                className="px-8 py-4 border border-white/15 text-stone-100 rounded-2xl hover:bg-white/5 transition-colors font-semibold text-lg"
              >
                View access policy
              </Link>
            </div>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-[2rem] p-8 backdrop-blur">
            <div className="grid gap-5">
              <div className="rounded-2xl bg-white/5 p-5 border border-white/10">
                <p className="text-sm text-stone-400 mb-1">Authentication</p>
                <p className="text-xl font-semibold">Database-backed revocable sessions</p>
              </div>
              <div className="rounded-2xl bg-white/5 p-5 border border-white/10">
                <p className="text-sm text-stone-400 mb-1">Authorization</p>
                <p className="text-xl font-semibold">Role and permission enforcement on the server</p>
              </div>
              <div className="rounded-2xl bg-white/5 p-5 border border-white/10">
                <p className="text-sm text-stone-400 mb-1">Governance</p>
                <p className="text-xl font-semibold">Audit visibility for admin-driven account changes</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-stone-900/80 border-y border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 grid md:grid-cols-3 gap-8">
          <article className="rounded-3xl bg-stone-950 border border-white/10 p-8">
            <h2 className="text-2xl font-semibold mb-3">Admin</h2>
            <p className="text-stone-300 leading-7">
              Create accounts, assign roles, review audit activity, and control
              access centrally.
            </p>
          </article>
          <article className="rounded-3xl bg-stone-950 border border-white/10 p-8">
            <h2 className="text-2xl font-semibold mb-3">Editor</h2>
            <p className="text-stone-300 leading-7">
              Collaborate on business content with focused write permissions and
              less platform risk.
            </p>
          </article>
          <article className="rounded-3xl bg-stone-950 border border-white/10 p-8">
            <h2 className="text-2xl font-semibold mb-3">Viewer</h2>
            <p className="text-stone-300 leading-7">
              Read the information you need without opening broad operational
              privileges.
            </p>
          </article>
        </div>
      </section>
    </div>
  );
}
