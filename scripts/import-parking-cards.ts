/**
 * Loads the fleet's parking cards and their balances from a data file
 * (scripts/data/parking-cards-opening-2026-11.json, from the PAYTECH, KAPS and
 * PARK n GO spreadsheets).
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/import-parking-cards.ts scripts/data/parking-cards-opening-2026-11.json
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/import-parking-cards.ts scripts/data/parking-cards-opening-2026-11.json --apply
 *
 * Without --apply it only prints what it would do. Safe to run again: a card
 * whose name already exists is left alone. Each new card is linked to its
 * vehicle by registration (spaces and case ignored; a vehicle the register
 * lacks is added as one of ours) and starts with one "Balance check" entry for
 * what the spreadsheet last recorded, dated when it was recorded.
 */
import { readFileSync } from 'node:fs';

import { PARKING_PROVIDERS, defaultParkingThreshold } from '@/lib/parking-cards';
import { prisma } from '@/lib/prisma';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';

type Row = { provider: string; vehicle: string | null; name?: string; cardNumber: string | null; balance: number; asOf: string; notes?: string };

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const apply = args.includes('--apply');
if (!file) {
  console.error('Usage: import-parking-cards.ts <data.json> [--apply]');
  process.exit(1);
}

const plate = (reg: string) => reg.replace(/\s+/g, '').toUpperCase();
const nameOf = (row: Row) => row.name ?? `${row.vehicle ?? 'Spare'} · ${row.provider}`;

async function main() {
  const data = JSON.parse(readFileSync(file!, 'utf8')) as { source?: string; cards: Row[] };
  for (const row of data.cards) {
    if (!(PARKING_PROVIDERS as readonly string[]).includes(row.provider)) throw new Error(`Unknown provider ${row.provider}`);
    if (!row.asOf) throw new Error(`${nameOf(row)} has no date`);
  }
  const admin = await prisma.user.findFirst({
    where: { status: 'active', userRoles: { some: { role: { name: ADMIN_ROLE_NAME } } } },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  if (!admin) throw new Error('No active admin to record the import as.');

  const vehicles = await prisma.vehicle.findMany({ select: { id: true, registration: true } });
  const byPlate = new Map(vehicles.map((v) => [plate(v.registration), v.id]));
  const existing = new Set((await prisma.parkingCard.findMany({ select: { name: true } })).map((c) => c.name));
  const toCreate = data.cards.filter((row) => !existing.has(nameOf(row)));
  const missing = [...new Set(toCreate.map((r) => r.vehicle).filter((v): v is string => Boolean(v) && !byPlate.has(plate(v!))))];

  console.log(`Source: ${data.source ?? file}`);
  console.log(`${apply ? 'Importing' : 'Dry run (add --apply to write)'}: ${toCreate.length} new card(s), ${data.cards.length - toCreate.length} already present.`);
  if (missing.length) console.log(`Vehicles to add as internal: ${missing.join(', ')}`);
  for (const row of toCreate) console.log(`  + ${nameOf(row).padEnd(26)} ${(row.cardNumber ?? '').padEnd(9)} KES ${row.balance.toLocaleString('en-KE')} on ${row.asOf}`);
  if (!apply) return;

  await prisma.$transaction(async (tx) => {
    for (const reg of missing) {
      const v = await tx.vehicle.create({
        data: { registration: reg, ownership: 'Internal', notes: 'Added by the parking card import; fill in make and model.', createdById: admin.id },
        select: { id: true },
      });
      byPlate.set(plate(reg), v.id);
    }
    for (const row of toCreate) {
      const card = await tx.parkingCard.create({
        data: {
          name: nameOf(row),
          provider: row.provider,
          vehicleId: row.vehicle ? byPlate.get(plate(row.vehicle))! : null,
          cardNumber: row.cardNumber,
          lowBalanceThreshold: defaultParkingThreshold(row.provider),
          notes: row.notes ?? null,
          createdById: admin.id,
        },
        select: { id: true },
      });
      await tx.parkingCardEntry.create({
        data: {
          cardId: card.id,
          kind: 'Balance check',
          amount: row.balance,
          observedBalance: row.balance,
          occurredAt: new Date(`${row.asOf}T09:00:00+03:00`),
          notes: 'Balance carried over from the parking card spreadsheet.',
          createdById: admin.id,
        },
      });
    }
  });
  console.log(`\nDone: ${toCreate.length} card(s) added, ${missing.length} vehicle(s) added.`);
  const low = toCreate.filter((r) => r.balance < defaultParkingThreshold(r.provider));
  if (low.length) console.log(`Below the minimum at import: ${low.map((r) => `${nameOf(r)} (KES ${r.balance})`).join('; ')}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
