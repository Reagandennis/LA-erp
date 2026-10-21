/**
 * What a verifier confirms before closing out a completed trip. Shared by the
 * Close out tab, the validation schema and lib/trip-closeout.ts; the keys are
 * stored on TripCloseout.checks, so rename a label freely but never a key.
 */
export const CLOSEOUT_CHECKS = [
  { key: 'itinerary', label: 'Itinerary delivered', hint: 'Every stop ran as planned, or the changes are in the trip log.' },
  { key: 'crew', label: 'Crew and vehicles stood down', hint: 'Drivers, CPOs and vehicles released and returned.' },
  { key: 'expenses', label: 'Expenses reconciled', hint: 'Receipts collected and costs matched to the quote.' },
  { key: 'incidents', label: 'Incidents reported', hint: 'Anything that went wrong is written up, or nothing did.' },
  { key: 'client', label: 'Client debriefed', hint: 'The client or lead traveller has been asked how it went.' },
  { key: 'documents', label: 'Documents filed', hint: 'Tickets, vouchers and the operations log are complete.' },
] as const;

export type CloseoutCheckKey = (typeof CLOSEOUT_CHECKS)[number]['key'];

export const CLOSEOUT_CHECK_KEYS = CLOSEOUT_CHECKS.map((check) => check.key) as [CloseoutCheckKey, ...CloseoutCheckKey[]];

/** A trip is closed out only once every check is confirmed. */
export function allChecksConfirmed(checks: readonly string[]): boolean {
  return CLOSEOUT_CHECK_KEYS.every((key) => checks.includes(key));
}
