import 'server-only';

import { prisma } from './prisma';

/**
 * Google People API import.
 *
 * The browser obtains a short-lived access token through Google Identity
 * Services and posts it here; we never store it. That makes this a
 * user-triggered import rather than a background sync — a background job would
 * need an offline refresh token from the server-side OAuth code flow.
 */

const PEOPLE_ENDPOINT = 'https://people.googleapis.com/v1/people/me/connections';
const PERSON_FIELDS =
  'names,emailAddresses,phoneNumbers,organizations,addresses,biographies,metadata';
const PAGE_SIZE = 500;
/** Hard ceiling so one import can't run away on a very large address book. */
const MAX_CONTACTS = 2000;

export const GOOGLE_CONTACTS_SCOPE =
  'https://www.googleapis.com/auth/contacts.readonly';

interface GooglePerson {
  resourceName?: string;
  names?: Array<{ displayName?: string; metadata?: { primary?: boolean } }>;
  emailAddresses?: Array<{ value?: string; metadata?: { primary?: boolean } }>;
  phoneNumbers?: Array<{ value?: string; metadata?: { primary?: boolean } }>;
  organizations?: Array<{ name?: string; title?: string }>;
  addresses?: Array<{ formattedValue?: string; city?: string; country?: string }>;
  biographies?: Array<{ value?: string }>;
}

export interface SyncResult {
  created: number;
  updated: number;
  skipped: number;
  total: number;
  truncated: boolean;
}

function primary<T extends { metadata?: { primary?: boolean } }>(
  values: T[] | undefined,
): T | null {
  if (!values || values.length === 0) return null;
  return values.find((value) => value.metadata?.primary) ?? values[0];
}

function trimOrNull(value: string | undefined | null): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

export interface MappedContact {
  resourceName: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  location: string | null;
  notes: string | null;
}

/** Maps a People API person onto our Contact shape, or null if unusable. */
export function mapPerson(person: GooglePerson): MappedContact | null {
  const resourceName = trimOrNull(person.resourceName);
  if (!resourceName) return null;

  const name = trimOrNull(primary(person.names)?.displayName);
  const email = trimOrNull(primary(person.emailAddresses)?.value);
  const phone = trimOrNull(primary(person.phoneNumbers)?.value);

  // A contact with no name and no way to reach them is not worth importing.
  if (!name && !email && !phone) return null;

  const organization = person.organizations?.[0];
  const role = trimOrNull(
    [organization?.title, organization?.name].filter(Boolean).join(' · '),
  );

  const address = person.addresses?.[0];
  const location = trimOrNull(
    address?.formattedValue ??
      [address?.city, address?.country].filter(Boolean).join(', '),
  );

  return {
    resourceName,
    name: name ?? email ?? phone ?? 'Unnamed contact',
    email,
    phone,
    role,
    location,
    notes: trimOrNull(person.biographies?.[0]?.value),
  };
}

/** Pages through the caller's Google connections. */
export async function fetchGoogleConnections(
  accessToken: string,
): Promise<{ people: GooglePerson[]; truncated: boolean }> {
  const people: GooglePerson[] = [];
  let pageToken: string | undefined;
  let truncated = false;

  do {
    const url = new URL(PEOPLE_ENDPOINT);
    url.searchParams.set('personFields', PERSON_FIELDS);
    url.searchParams.set('pageSize', String(PAGE_SIZE));
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(
        response.status === 401 || response.status === 403
          ? 'Google rejected the request. Re-connect your Google account and make sure contacts access was granted.'
          : `Google People API error (${response.status}). ${detail.slice(0, 200)}`,
      );
    }

    const body = (await response.json()) as {
      connections?: GooglePerson[];
      nextPageToken?: string;
    };

    people.push(...(body.connections ?? []));
    pageToken = body.nextPageToken;

    if (people.length >= MAX_CONTACTS) {
      truncated = Boolean(pageToken);
      break;
    }
  } while (pageToken);

  return { people: people.slice(0, MAX_CONTACTS), truncated };
}

/**
 * Upserts mapped contacts by Google resource name.
 *
 * Google owns name/email/phone/role/location, so those are refreshed on every
 * run. Locally-set fields — category, tags, notes, linked customer — are left
 * alone so a re-sync never discards work done inside the platform.
 */
export async function upsertGoogleContacts(
  userId: number,
  mapped: MappedContact[],
): Promise<Omit<SyncResult, 'truncated'>> {
  let created = 0;
  let updated = 0;

  const existing = await prisma.contact.findMany({
    where: { googleResourceName: { in: mapped.map((entry) => entry.resourceName) } },
    select: { id: true, googleResourceName: true, notes: true },
  });
  const byResource = new Map(
    existing.map((row) => [row.googleResourceName as string, row]),
  );

  for (const entry of mapped) {
    const match = byResource.get(entry.resourceName);
    const syncedAt = new Date();

    if (match) {
      await prisma.contact.update({
        where: { id: match.id },
        data: {
          name: entry.name,
          email: entry.email,
          phone: entry.phone,
          role: entry.role,
          location: entry.location,
          // Never overwrite a note someone wrote here.
          notes: match.notes ?? entry.notes,
          source: 'google',
          syncedAt,
        },
      });
      updated += 1;
    } else {
      await prisma.contact.create({
        data: {
          name: entry.name,
          email: entry.email,
          phone: entry.phone,
          role: entry.role,
          location: entry.location,
          notes: entry.notes,
          tags: ['google'],
          source: 'google',
          googleResourceName: entry.resourceName,
          syncedAt,
          createdById: userId,
        },
      });
      created += 1;
    }
  }

  return { created, updated, skipped: 0, total: mapped.length };
}

export async function syncGoogleContacts(
  userId: number,
  accessToken: string,
): Promise<SyncResult> {
  const { people, truncated } = await fetchGoogleConnections(accessToken);

  const mapped: MappedContact[] = [];
  let skipped = 0;

  for (const person of people) {
    const entry = mapPerson(person);
    if (entry) mapped.push(entry);
    else skipped += 1;
  }

  const result = await upsertGoogleContacts(userId, mapped);

  return { ...result, skipped, total: people.length, truncated };
}
