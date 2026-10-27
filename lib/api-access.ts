import { PEOPLE_MODULE_SLUGS } from './people-views';

/**
 * Which modules may use each API — the one place that answers "who can call
 * this?". Routes pass a list to `requireModuleRequest(request, ...API_ACCESS.x)`:
 * the caller must be an admin or hold at least one of those modules.
 *
 * An API is listed under every module whose pages call it, so locking it to
 * one never breaks another (customer contacts are managed from the CRM, the
 * invoice builder reuses the quote builder's customer picker, and so on).
 *
 * Signing in alone is deliberately enough only for routes that return the
 * caller's own data — notification feeds, presence, preferences, the live
 * streams — or that check access themselves (search). tests/api-access.test.ts
 * fails if a route is added without either.
 */
export const API_ACCESS = {
  /** Accounting connections (QuickBooks, Wave) — invoices, and Wave's quote estimates. */
  accounting: ['invoices-review', 'quotes'],
  calendar: ['calendar'],
  communication: ['communication'],
  contacts: ['contact-list', 'customers'],
  contracts: ['contract-renewal'],
  crm: ['customers'],
  feedback: ['feedback'],
  files: ['file-upload'],
  /** The Fleet modules beside Vehicles: each is its own grant. */
  fleetFuel: ['car-fuel'],
  fleetMaintenance: ['car-maintenance'],
  /** Flight lookups call a paid outside service; the tracker and trip flight cards use them. */
  flights: ['flight-tracker', 'trip-planning'],
  intel: ['intel'],
  /** Driver licences: their own module, and the people directory's driver profiles. */
  licences: ['drivers-license-expiry', ...PEOPLE_MODULE_SLUGS],
  notes: ['notes'],
  quotes: ['quotes'],
  /** Shared by the quote and invoice builders' customer picker, and the CRM. */
  quoteCustomers: ['quotes', 'invoices-review', 'customers'],
  /** The catalogue is managed in Products & Services and picked from in both builders. */
  quoteProducts: ['quotes', 'products-services', 'invoices-review'],
  /** Brand profiles and approvers are chosen on quotes and on invoices. */
  quoteBranding: ['quotes', 'invoices-review'],
  sops: ['sops'],
  taskAssignment: ['task-assignment'],
  /** Vehicles are run from their own module as well as from task assignment. */
  vehicles: ['task-assignment', 'vehicles'],
  tasks: ['todo-personal'],
  trips: ['trip-planning'],
  /** Close-out is its own grant: verifiers needn't plan trips, and not every planner verifies. */
  tripCloseout: ['trip-closeout'],
} as const satisfies Record<string, readonly string[]>;
