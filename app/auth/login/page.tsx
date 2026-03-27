'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ChangeEvent, type FormEvent, useState } from 'react';

async function readJsonSafely(response: Response) {
  const contentType = response.headers.get('content-type') ?? '';

  if (!contentType.includes('application/json')) {
    return null;
  }

  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as { error?: string } | null;
  } catch {
    return null;
  }
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });

      const data = await readJsonSafely(response);

      if (!response.ok) {
        setError(data?.error || 'Unable to sign in');
        return;
      }

      router.push('/dashboard');
      router.refresh();
    } catch (caughtError) {
      console.error(caughtError);
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-6 py-12">
      <div className="w-full max-w-md border border-gray-300 bg-white p-8 text-center">
        <p className="text-xl font-semibold text-gray-900">Lady askari</p>
        <h1 className="mt-6 text-2xl font-semibold text-gray-900">Login</h1>
        <p className="mt-2 text-sm text-gray-600">
          Sign in with your account details.
        </p>

        {error && (
          <div className="mt-6 border border-red-300 bg-red-50 p-3 text-left text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4 text-left">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm text-gray-700">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setEmail(event.target.value)
              }
              className="w-full border border-gray-300 px-3 py-2 text-gray-900"
              autoComplete="email"
              required
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm text-gray-700">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setPassword(event.target.value)
              }
              className="w-full border border-gray-300 px-3 py-2 text-gray-900"
              autoComplete="current-password"
              required
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full border border-gray-900 bg-gray-900 px-3 py-2 text-white disabled:opacity-60"
          >
            {isLoading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <div className="mt-6 text-sm text-gray-600">
          <Link href="/" className="underline">
            Home
          </Link>
          {' | '}
          <Link href="/auth/signup" className="underline">
            Signup
          </Link>
        </div>
      </div>
    </div>
  );
}
