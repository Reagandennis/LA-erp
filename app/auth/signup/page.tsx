import Link from 'next/link';

export default function SignupPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-6 py-12">
      <div className="w-full max-w-md border border-gray-300 bg-white p-8 text-center">
        <p className="text-xl font-semibold text-gray-900">Lady askari</p>
        <h1 className="mt-6 text-2xl font-semibold text-gray-900">Signup</h1>
        <p className="mt-2 text-sm text-gray-600">
          Accounts are created by an administrator.
        </p>
        <p className="mt-4 text-sm text-gray-600">
          Contact the administrator if you need access.
        </p>

        <div className="mt-6 text-sm text-gray-600">
          <Link href="/auth/login" className="underline">
            Login
          </Link>
          {' | '}
          <Link href="/" className="underline">
            Home
          </Link>
        </div>
      </div>
    </div>
  );
}
