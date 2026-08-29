import { describe, expect, it } from 'vitest';

import { mapsAuthFailure, onMapsAuthFailure, reportMapsAuthFailure } from '../lib/google-maps';

/**
 * Google reports a bad key by calling `gm_authFailure` *after* the bootstrap
 * callback has already resolved, and otherwise only paints its own grey overlay.
 * If this plumbing breaks, the map silently looks broken with no explanation —
 * which is exactly the failure this module exists to prevent.
 */
describe('Maps auth failure reporting', () => {
  it('starts clean', () => {
    expect(mapsAuthFailure()).toBeNull();
  });

  it('notifies every current subscriber with an actionable reason', () => {
    const seen: string[] = [];
    const stopA = onMapsAuthFailure((reason) => seen.push(`a:${reason}`));
    const stopB = onMapsAuthFailure((reason) => seen.push(`b:${reason}`));

    reportMapsAuthFailure();

    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatch(/^a:/);
    expect(seen[1]).toMatch(/^b:/);
    // The message has to name what the reader can actually go and change.
    for (const entry of seen) {
      expect(entry).toMatch(/key/i);
      expect(entry).toMatch(/billing|enabled|origin/i);
    }
    stopA();
    stopB();
  });

  it('remembers the failure so a later subscriber is told immediately', () => {
    expect(mapsAuthFailure()).not.toBeNull();
    let reason: string | null = null;
    const stop = onMapsAuthFailure((r) => {
      reason = r;
    });
    // A component mounting after the failure must still render the error state.
    expect(reason).not.toBeNull();
    stop();
  });

  it('stops notifying once unsubscribed', () => {
    let calls = 0;
    const stop = onMapsAuthFailure(() => {
      calls += 1;
    });
    expect(calls).toBe(1); // replayed on subscribe
    stop();
    reportMapsAuthFailure('a second failure');
    expect(calls).toBe(1);
  });
});
