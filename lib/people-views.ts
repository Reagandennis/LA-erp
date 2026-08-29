/**
 * Shared configuration for the five people directories: the all-people
 * `personnel` module plus one module per operational role.
 *
 * Deliberately NOT `server-only` — the server pages and the client directory
 * component both import it, the same way `lib/module-catalog.ts` is shared.
 */

/** Operational roles a person can be assigned in. A person may hold several. */
export const PERSONNEL_ROLES = ['Driver', 'CPO', 'Airport Greeter', 'Security Advisor'] as const;

/** How a person is engaged — they may come from a vendor or be a consultant. */
export const ENGAGEMENT_TYPES = ['Employee', 'Vendor', 'Consultant', 'Contractor'] as const;

/**
 * Grades offered on a person. The legacy `OFFICER_GRADES` in
 * `lib/task-assignment.ts` also carries 'Driver/CPO'; that compound value is the
 * old string hack for multi-role and is deliberately NOT offered here — holding
 * both the CPO and Driver roles is how that is expressed now. It stays in the
 * legacy list because `pickGrade` silently demotes unknown values.
 */
export const CPO_GRADES = ['CPO', 'Team Leader', 'Detail Leader'] as const;

export type PersonnelRole = (typeof PERSONNEL_ROLES)[number];
export type EngagementType = (typeof ENGAGEMENT_TYPES)[number];
export type CpoGrade = (typeof CPO_GRADES)[number];

export function isPersonnelRole(value: unknown): value is PersonnelRole {
  return (PERSONNEL_ROLES as readonly string[]).includes(value as string);
}

export type PeopleView = {
  /** Module slug — also the RBAC key and the URL segment. */
  slug: string;
  /** Role this page is scoped to; null means every person. */
  role: PersonnelRole | null;
  title: string;
  subtitle: string;
  addLabel: string;
  emptyTitle: string;
  emptyHint: string;
  searchPlaceholder: string;
  /** Show the driving-licence panel and its compliance stat. */
  showLicences: boolean;
  /** Show call sign + grade. */
  showCallSign: boolean;
  /**
   * The assignable resource this role mirrors, if any. Airport greeters and
   * security advisors have none: `TripAssignment` only has driver and officer
   * slots, so those two roles are directory-only for now.
   */
  mirrors: 'driver' | 'officer' | null;
};

export const PEOPLE_VIEWS: Record<string, PeopleView> = {
  personnel: {
    slug: 'personnel',
    role: null,
    title: 'Personnel',
    subtitle: 'Everyone we assign to work — employees, vendor staff and consultants.',
    addLabel: 'Add person',
    emptyTitle: 'No personnel yet',
    emptyHint: 'Add your first team member to get started.',
    searchPlaceholder: 'Search by name, role, email or phone…',
    showLicences: true,
    showCallSign: true,
    mirrors: null,
  },
  drivers: {
    slug: 'drivers',
    role: 'Driver',
    title: 'Drivers',
    subtitle: 'Personnel who can be assigned as a driver, with licence compliance.',
    addLabel: 'Add driver',
    emptyTitle: 'No drivers yet',
    emptyHint: 'Add a person with the Driver role, or tick Driver on an existing record.',
    searchPlaceholder: 'Search drivers by name, licence or phone…',
    showLicences: true,
    showCallSign: false,
    mirrors: 'driver',
  },
  cpos: {
    slug: 'cpos',
    role: 'CPO',
    title: 'Close Protection Officers',
    subtitle: 'Personnel who can be assigned as a CPO, with call sign and grade.',
    addLabel: 'Add officer',
    emptyTitle: 'No officers yet',
    emptyHint: 'Add a person with the CPO role, or tick CPO on an existing record.',
    searchPlaceholder: 'Search officers by name, call sign or phone…',
    showLicences: false,
    showCallSign: true,
    mirrors: 'officer',
  },
  'airport-greeters': {
    slug: 'airport-greeters',
    role: 'Airport Greeter',
    title: 'Airport Greeters',
    subtitle: 'Personnel who meet and escort travellers through airports.',
    addLabel: 'Add greeter',
    emptyTitle: 'No airport greeters yet',
    emptyHint: 'Add a person with the Airport Greeter role.',
    searchPlaceholder: 'Search greeters by name, location or phone…',
    showLicences: false,
    showCallSign: false,
    mirrors: null,
  },
  'security-advisors': {
    slug: 'security-advisors',
    role: 'Security Advisor',
    title: 'Security Advisors',
    subtitle: 'Personnel who advise on risk, planning and protective posture.',
    addLabel: 'Add advisor',
    emptyTitle: 'No security advisors yet',
    emptyHint: 'Add a person with the Security Advisor role.',
    searchPlaceholder: 'Search advisors by name, location or phone…',
    showLicences: false,
    showCallSign: false,
    mirrors: null,
  },
};

/** Every slug that serves the people directory — used to gate the shared API. */
export const PEOPLE_MODULE_SLUGS = Object.keys(PEOPLE_VIEWS);
