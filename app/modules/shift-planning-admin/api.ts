import type { SaveResult } from '@/lib/shift-types';

/** Client calls to the shift-planning admin API. */

export class ApiError extends Error {}

async function parse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !body) throw new ApiError(body?.error || 'Something went wrong. Please try again.');
  return body;
}

export async function getJson<T>(url: string): Promise<T> {
  return parse<T>(await fetch(url, { cache: 'no-store' }));
}

export async function sendJson<T>(url: string, method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', body?: unknown): Promise<T> {
  return parse<T>(
    await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

/**
 * A save the rules can stop. A 409 is not an error: it carries the warnings to
 * confirm or the blocks to approve, and comes back as `saved: false`.
 */
export async function saveChecked(url: string, body: unknown): Promise<SaveResult> {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (response.status === 409) return (await response.json()) as SaveResult;
  return parse<SaveResult>(response);
}

export const message = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);
