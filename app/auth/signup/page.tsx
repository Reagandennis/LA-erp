import Link from 'next/link';

export default function SignupPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center px-6 py-16">
      <div className="max-w-xl w-full bg-slate-900 border border-slate-800 rounded-3xl p-10 shadow-2xl">
        <p className="text-sm uppercase tracking-[0.3em] text-emerald-300 mb-4">
          Access is managed
        </p>
        <h1 className="text-4xl font-bold mb-4">Accounts are created by an administrator</h1>
        <p className="text-slate-300 leading-7 mb-8">
          LA-ERP no longer supports public self-registration. If you need access,
          contact your platform administrator to create your account and assign
          the correct role.
        </p>
        <div className="flex flex-col sm:flex-row gap-4">
          <Link
            href="/auth/login"
            className="px-5 py-3 bg-emerald-500 text-slate-950 rounded-xl font-semibold text-center"
          >
            Go to sign in
          </Link>
          <Link
            href="/"
            className="px-5 py-3 border border-slate-700 rounded-xl font-semibold text-center text-slate-200"
          >
            Return home
          </Link>
        </div>
      </div>
    </div>
  );
}
