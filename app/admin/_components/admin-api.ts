import { SILENT_BANNER_HEADER } from '@/app/ui/banner';

/**
 * Fetch JSON from an admin route; throws the server's message on failure.
 *
 * The app's generic "User saved" banner is silenced: the console reports each
 * outcome itself, in words specific to what was done.
 */
export async function adminFetch<T = Record<string, unknown>>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    credentials: 'include',
    ...init,
    headers: {
      [SILENT_BANNER_HEADER]: '1',
      ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const payload = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok) throw new Error(payload?.error || `Request failed (${response.status})`);
  return (payload ?? {}) as T;
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
