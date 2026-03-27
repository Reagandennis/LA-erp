'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface LogoutButtonProps {
  variant?: 'default' | 'ghost';
  className?: string;
}

export default function LogoutButton({ variant = 'default', className }: LogoutButtonProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  if (variant === 'ghost') {
    return (
      <button
        type="button"
        disabled={isPending}
        title="Sign out"
        onClick={async () => {
          setIsPending(true);
          try {
            await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
          } finally {
            router.push('/auth/login');
            router.refresh();
          }
        }}
        className={className}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
        </svg>
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={async () => {
        setIsPending(true);
        try {
          await fetch('/api/auth/logout', {
            method: 'POST',
            credentials: 'include',
          });
        } finally {
          router.push('/auth/login');
          router.refresh();
        }
      }}
      className={`px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium disabled:opacity-60 ${className}`}
    >
      {isPending ? 'Signing out...' : 'Sign out'}
    </button>
  );
}
