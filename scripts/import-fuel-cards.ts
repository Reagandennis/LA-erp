/**
 * Loads the fleet's fuel cards and their opening balances from a data file
 * (scripts/data/fuel-cards-opening-2026-11.json, taken from the Lioness and
 * Lady Askari fuel card spreadsheets).
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/import-fuel-cards.ts scripts/data/fuel-cards-opening-2026-11.json
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/import-fuel-cards.ts scripts/data/fuel-cards-opening-2026-11.json --apply
 *
 * Without --apply it only prints what it would do. Safe to run again: a card
 * whose name already exists is left alone. For each new card it:
 *   - links it to its vehicle by registration (spaces and case ignored),
 *     adding the vehicle as one of ours if the register doesn't have it;
 *   - records its balance as one "Opening balance" adjustment on the date the
 *     spreadsheet last checked it (none for a zero or unknown balance);
 *   - marks a card that starts below its alert level as already alerted, so
 *     the import doesn't send admins a burst of low-balance emails. It shows
 *     as low on the page and alerts again after its next top-up and dip.
 * It then removes the generic cards the module started with (and any others
 * named like them), but only those with no top-ups or fill-ups.
 *
 * PINs never go in: the data file has none.
 */
import { readFileSync } from 'node:fs';

import { DEFAULT_LOW_BALANCE_THRESHOLD, FUEL_CARD_ENTITIES, FUEL_CARD_PROVIDERS, entityLabel } from '@/lib/fuel-cards';
import { prisma } from '@/lib/prisma';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';

type CardRow = {
  entity: string;
  vehicle: string | null;
  provider: string;
  cardNumber: string | null;
  balance: number | null;
  asOf?: string;
  active?: boolean;
  notes?: string;
};

const GENERIC_NAMES = ['Shell Fuel Card', 'TotalEnergies Fuel Card', 'Total Energies'];
const UNKNOWN_NOTE = 'Balance not in the spreadsheet: confirm it with the provider, then record it as an adjustment.';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const apply = args.includes('--apply');
if (!file) {
  console.error('Usage: import-fuel-cards.ts <data.json> [--apply]');
  process.exit(1);
}

const plate = (reg: string) => reg.replace(/\s+/g, '').toUpperCase();
const shortEntity = (entity: string) => entityLabel(entity).replace(/ Alliance$/, '');
const cardName = (row: CardRow) => `${row.vehicle ?? 'Spare'} · ${row.provider} · ${shortEntity(row.entity)}`;
const kes = (n: number) => `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

async function main() {
  const data = JSON.parse(readFileSync(file!, 'utf8')) as { source?: string; cards: CardRow[] };
  for (const row of data.cards) {
    if (!(FUEL_CARD_ENTITIES as readonly string[]).includes(row.entity)) throw new Error(`Unknown company ${row.entity}`);
    if (!(FUEL_CARD_PROVIDERS as readonly string[]).includes(row.provider)) throw new Error(`Unknown provider ${row.provider}`);
    if (row.balance != null && row.balance > 0 && !row.asOf) throw new Error(`${cardName(row)} has a balance but no date`);
  }

  const admin = await prisma.user.findFirst({
    where: { status: 'active', userRoles: { some: { role: { name: ADMIN_ROLE_NAME } } } },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  if (!admin) throw new Error('No active admin to record the import as.');

  const vehicles = await prisma.vehicle.findMany({ select: { id: true, registration: true, ownership: true } });
  const byPlate = new Map(vehicles.map((v) => [plate(v.registration), v]));
  const existingNames = new Set((await prisma.fuelCard.findMany({ select: { name: true } })).map((c) => c.name));

  const wantedVehicles = [...new Set(data.cards.map((c) => c.vehicle).filter((v): v is string => Boolean(v)))];
  const missingVehicles = wantedVehicles.filter((reg) => !byPlate.has(plate(reg)));
  const notOurs = wantedVehicles.filter((reg) => byPlate.get(plate(reg)) && byPlate.get(plate(reg))!.ownership !== 'Internal');

  const toCreate = data.cards.filter((row) => !existingNames.has(cardName(row)));
  const skipped = data.cards.length - toCreate.length;

  console.log(`Source: ${data.source ?? file}`);
  console.log(`${apply ? 'Importing' : 'Dry run (add --apply to write)'}: ${toCreate.length} new card(s), ${skipped} already present.`);
  if (missingVehicles.length) console.log(`Vehicles to add as internal: ${missingVehicles.join(', ')}`);
  if (notOurs.length) console.log(`WARNING: in the register but not marked internal (cards can't pay for them until they are): ${notOurs.join(', ')}`);

  const low: string[] = [];
  const unknown: string[] = [];
  for (const row of toCreate) {
    const balance = row.balance ?? 0;
    const active = row.active ?? true;
    const line = `  + ${cardName(row).padEnd(38)} ${row.cardNumber ?? ''}`.padEnd(54);
    console.log(`${line} ${row.balance == null ? 'balance unknown' : kes(balance)}${row.asOf ? ` on ${row.asOf}` : ''}${active ? '' : ' (retired)'}`);
    if (row.balance == null) unknown.push(cardName(row));
    else if (active && balance < DEFAULT_LOW_BALANCE_THRESHOLD) low.push(`${cardName(row)} (${kes(balance)})`);
  }

  const generic = await prisma.fuelCard.findMany({
    where: { name: { in: GENERIC_NAMES }, vehicleId: null, topUps: { none: {} }, fuelLogs: { none: {} } },
    select: { id: true, name: true, entity: true },
  });
  for (const card of generic) console.log(`  - remove generic card #${card.id} ${card.name} (${entityLabel(card.entity)}), no history`);

  if (!apply) return;

  await prisma.$transaction(async (tx) => {
    for (const reg of missingVehicles) {
      const created = await tx.vehicle.create({
        data: { registration: reg, ownership: 'Internal', notes: 'Added by the fuel card import; fill in make and model.', createdById: admin.id },
        select: { id: true, registration: true, ownership: true },
      });
      byPlate.set(plate(reg), created);
    }
    const now = new Date();
    for (const row of toCreate) {
      const balance = row.balance ?? 0;
      const active = row.active ?? true;
      const notes = [row.notes, row.balance == null ? UNKNOWN_NOTE : null].filter(Boolean).join(' ') || null;
      const card = await tx.fuelCard.create({
        data: {
          name: cardName(row),
          provider: row.provider,
          entity: row.entity,
          cardNumber: row.cardNumber,
          vehicleId: row.vehicle ? byPlate.get(plate(row.vehicle))!.id : null,
          lowBalanceThreshold: DEFAULT_LOW_BALANCE_THRESHOLD,
          active,
          notes,
          // Already below its level: shown as low, without an alert burst on import day.
          lowAlertedAt: active && balance < DEFAULT_LOW_BALANCE_THRESHOLD ? now : null,
          createdById: admin.id,
        },
        select: { id: true },
      });
      if (balance !== 0) {
        await tx.fuelCardTopUp.create({
          data: {
            cardId: card.id,
            kind: 'Adjustment',
            amount: balance,
            // Mid-morning in Nairobi on the day the spreadsheet last checked it.
            occurredAt: new Date(`${row.asOf}T09:00:00+03:00`),
            reference: 'Opening balance',
            notes: 'Balance carried over from the fuel card spreadsheet.',
            createdById: admin.id,
          },
        });
      }
    }
    if (generic.length) await tx.fuelCard.deleteMany({ where: { id: { in: generic.map((c) => c.id) } } });
  });

  console.log(`\nDone: ${toCreate.length} card(s) added, ${missingVehicles.length} vehicle(s) added, ${generic.length} generic card(s) removed.`);
  if (low.length) console.log(`Below KES ${DEFAULT_LOW_BALANCE_THRESHOLD.toLocaleString('en-KE')} at import (no alert sent): ${low.join('; ')}`);
  if (unknown.length) console.log(`Balance unknown, at KES 0 with a note to check: ${unknown.join('; ')}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
