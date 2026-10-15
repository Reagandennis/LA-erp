/**
 * Rules behind the admin overview's "needs attention" items. They live here,
 * free of server code, because the Users tab applies the same rules to its
 * list: "3 accounts have never been used" on the overview opens exactly those 3.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** New accounts get this long to be used before they are flagged. */
export const NEVER_USED_GRACE_DAYS = 3;
/** Accounts not active for this long count as dormant. */
export const DORMANT_DAYS = 30;

type When = Date | string | null | undefined;

function time(value: When): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

export function isNeverUsed(createdAt: When, lastSeen: When, now: Date): boolean {
  const created = time(createdAt);
  return time(lastSeen) === null && created !== null && now.getTime() - created > NEVER_USED_GRACE_DAYS * DAY_MS;
}

export function isDormant(lastSeen: When, now: Date): boolean {
  const seen = time(lastSeen);
  return seen !== null && now.getTime() - seen > DORMANT_DAYS * DAY_MS;
}
