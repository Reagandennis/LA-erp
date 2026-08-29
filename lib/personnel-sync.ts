import 'server-only';

import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';

/**
 * Keeps the legacy assignable resources (`Driver`, `Officer`) in step with the
 * `Personnel` record that is now the master. Those two tables stay exactly where
 * they are so `TripAssignment`, `assertNoResourceConflicts` and the whole
 * task-assignment module keep working untouched — Personnel simply drives them.
 *
 * Two invariants are load-bearing:
 *
 *  1. A mirror row is NEVER deleted when a role is removed. `TripAssignment`
 *     points at it with `onDelete: SetNull`, so deleting would silently strip the
 *     driver/officer off every historical trip. We stamp `retiredAt` instead and
 *     hide it from pickers.
 *  2. `status` is owned by the assignment engine once it reads 'Assigned'. Sync
 *     must not clobber that, or a person edit would free a resource that is
 *     actually committed to a trip.
 */

/** Personnel statuses that mean "not available for work". */
const UNAVAILABLE_PERSONNEL_STATUSES = new Set(['On Leave', 'Terminated']);

/** Set by the assignment engine; never overwritten from here. */
const ENGINE_OWNED_STATUS = 'Assigned';

function mirrorStatusFor(personnelStatus: string): string {
  return UNAVAILABLE_PERSONNEL_STATUSES.has(personnelStatus) ? 'Off duty' : 'Available';
}

/**
 * The grade to show on the legacy Officer row. When a person holds both roles we
 * use the legacy compound value, which is exactly what it was invented to mean —
 * it keeps the task-assignment UI accurate without reintroducing the hack on
 * `Personnel`, where the two roles are modelled properly.
 */
function mirrorGradeFor(roles: string[], grade: string | null): string {
  if (roles.includes('CPO') && roles.includes('Driver')) return 'Driver/CPO';
  return grade ?? 'CPO';
}

/**
 * Reconcile a person's mirror rows with their roles. Idempotent — safe to call
 * after every write. Runs in a transaction so a person is never left with a
 * half-updated pair of mirrors.
 */
export async function syncPersonnelResources(personnelId: number): Promise<void> {
  const person = await prisma.personnel.findUnique({
    where: { id: personnelId },
    select: {
      id: true,
      name: true,
      phone: true,
      roles: true,
      status: true,
      callSign: true,
      grade: true,
      createdById: true,
      driverProfile: { select: { id: true, status: true, licenseNumber: true } },
      officerProfile: { select: { id: true, status: true } },
      licenses: {
        orderBy: { expiryDate: 'asc' },
        take: 1,
        select: { licenseNumber: true },
      },
    },
  });
  if (!person) return;

  const roles = person.roles ?? [];
  const wantsDriver = roles.includes('Driver');
  const wantsOfficer = roles.includes('CPO');
  const status = mirrorStatusFor(person.status);
  const primaryLicence = person.licenses[0]?.licenseNumber ?? null;

  const ops: Prisma.PrismaPromise<unknown>[] = [];

  // --- Driver mirror ---
  if (wantsDriver && !person.driverProfile) {
    ops.push(
      prisma.driver.create({
        data: {
          name: person.name,
          phone: person.phone,
          licenseNumber: primaryLicence,
          status,
          personnelId: person.id,
          createdById: person.createdById,
        },
      }),
    );
  } else if (wantsDriver && person.driverProfile) {
    const data: Record<string, unknown> = { name: person.name, phone: person.phone, retiredAt: null };
    if (person.driverProfile.status !== ENGINE_OWNED_STATUS) data.status = status;
    // Fill-if-blank only: `licenseNumber` is independently editable from the
    // task-assignment module and the AI fleet tools, so we never overwrite it.
    if (!person.driverProfile.licenseNumber && primaryLicence) data.licenseNumber = primaryLicence;
    ops.push(prisma.driver.update({ where: { id: person.driverProfile.id }, data }));
  } else if (!wantsDriver && person.driverProfile && person.driverProfile.status !== ENGINE_OWNED_STATUS) {
    ops.push(
      prisma.driver.update({
        where: { id: person.driverProfile.id },
        data: { retiredAt: new Date(), status: 'Off duty' },
      }),
    );
  }

  // --- Officer mirror ---
  const grade = mirrorGradeFor(roles, person.grade);
  if (wantsOfficer && !person.officerProfile) {
    ops.push(
      prisma.officer.create({
        data: {
          name: person.name,
          phone: person.phone,
          callSign: person.callSign,
          grade,
          status,
          personnelId: person.id,
          createdById: person.createdById,
        },
      }),
    );
  } else if (wantsOfficer && person.officerProfile) {
    const data: Record<string, unknown> = {
      name: person.name,
      phone: person.phone,
      callSign: person.callSign,
      grade,
      retiredAt: null,
    };
    if (person.officerProfile.status !== ENGINE_OWNED_STATUS) data.status = status;
    ops.push(prisma.officer.update({ where: { id: person.officerProfile.id }, data }));
  } else if (!wantsOfficer && person.officerProfile && person.officerProfile.status !== ENGINE_OWNED_STATUS) {
    ops.push(
      prisma.officer.update({
        where: { id: person.officerProfile.id },
        data: { retiredAt: new Date(), status: 'Off duty' },
      }),
    );
  }

  // Keep the denormalised licence display name true. `lib/due-dates.ts`,
  // `lib/reports.ts` and `lib/dashboard-highlights.ts` all read `driverName`,
  // so it must never drift from the person's name.
  ops.push(
    prisma.driverLicense.updateMany({
      where: { personnelId: person.id, driverName: { not: person.name } },
      data: { driverName: person.name },
    }),
  );

  if (ops.length > 0) await prisma.$transaction(ops);
}

export type UnlinkedResources = {
  drivers: { id: number; name: string }[];
  officers: { id: number; name: string }[];
  licenses: { id: number; driverName: string; licenseNumber: string }[];
};

/**
 * Rows that the backfill could not attach to a person, plus anything created
 * since directly against the legacy tables. Surfaced in the UI so an admin can
 * reconcile them by hand — the backfill deliberately guesses at nothing.
 */
export async function listUnlinkedResources(): Promise<UnlinkedResources> {
  const [drivers, officers, licenses] = await Promise.all([
    prisma.driver.findMany({
      where: { personnelId: null, retiredAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.officer.findMany({
      where: { personnelId: null, retiredAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.driverLicense.findMany({
      where: { personnelId: null },
      orderBy: { driverName: 'asc' },
      select: { id: true, driverName: true, licenseNumber: true },
    }),
  ]);
  return { drivers, officers, licenses };
}
