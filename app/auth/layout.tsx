import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { getServerAuth } from '@/lib/auth';

// Checked against the Session row, the same source of truth the protected
// pages use, so a stale cookie lands on the login form instead of looping.
export default async function AuthLayout({ children }: { children: ReactNode }) {
  if (await getServerAuth()) redirect('/dashboard');
  return children;
}
