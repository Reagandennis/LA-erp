/**
 * Scoped variant of import-filemaker.ts (2026-11-18): reloads only the trips
 * still running or planned in FileMaker, onto a database that keeps its
 * reference lists.
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/import-fm-active-trips.ts <export folder> --dry-run
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/import-fm-active-trips.ts <export folder> --wipe
 *
 * --dry-run  maps everything and prints what would be written; touches nothing.
 * --wipe     empties every table except those in KEEP_TABLES: users and their
 *            access, settings, shift planning, the service catalogue, and the
 *            personnel/driver/officer/vehicle/vendor lists. Takes no backup
 *            itself: run pg_dump first.
 *
 * Imported: only tasks whose status is Ongoing, Approved - Pending Task Start
 * or Confirmed - Planning, with their journeys, travellers and task logs, plus
 * every client. Crew and vehicles are linked to the existing Driver/Officer/
 * Vehicle rows by name/registration; unmatched ones stay as text on the stop.
 *
 * FileMaker → app:
 *   client → Customer (+ Contact for its POCs, CrmActivity notes)
 *   traveler (on an imported trip) → Traveler
 *   task → Trip · journey → TripDay + transport TripItineraryItem
 *   journeyStaff → TripAssignment · journeyTraveler → TripTraveler
 *   taskLog → TripLogEntry · resourceSummary → the trip's notes
 * Container fields (documents) were not exported, so only their names are noted.
 * FileMaker times are Nairobi wall-clock times (UTC+3), which is how the team
 * reads them in the app too.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { transportTypeForRoute } from '@/lib/service-catalog';

type Row = Record<string, string>;

const args = process.argv.slice(2);
const exportDir = args.find((a) => !a.startsWith('--'));
const DRY_RUN = args.includes('--dry-run');
const WIPE = args.includes('--wipe');
if (!exportDir || [DRY_RUN, WIPE].filter(Boolean).length !== 1) {
  console.error('Usage: import-fm-active-trips.ts <export folder> (--dry-run | --wipe)');
  process.exit(1);
}

const ACTIVE_STATUSES = new Set(['ongoing', 'approved - pending task start', 'confirmed - planning']);

const warnings: string[] = [];
const warn = (message: string) => warnings.push(message);

// ─── CSV ────────────────────────────────────────────────────────────────────────

function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows;
  header[0] = header[0].replace(/^﻿/, '');
  return body
    .filter((r) => r.length > 1 || r[0]?.trim())
    .map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').replace(/\r\n?/g, '\n').trim()])));
}

function table(name: string): Row[] {
  return parseCsv(readFileSync(join(exportDir!, `${name}.csv`), 'utf8'));
}

// ─── Values ─────────────────────────────────────────────────────────────────────

const orNull = (value: string | undefined) => (value && value.trim() ? value.trim() : null);
const oneLine = (value: string | undefined) => orNull(value?.replace(/\s+/g, ' '));
const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);
const clipOrNull = (value: string | null | undefined, max: number) => (value ? clip(value, max) : null);
const lines = (...parts: Array<string | null | undefined | false>) =>
  parts.filter((p): p is string => typeof p === 'string' && p.trim().length > 0).join('\n') || null;

/** "2024-12-09 10:52:43" in Nairobi time. */
function nairobi(timestamp: string | undefined): Date | null {
  const m = timestamp?.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(:\d{2})?/);
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]}${m[3] ?? ':00'}+03:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const isDate = (value: string | undefined): value is string => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);

/** Date-only values are stored as UTC midnight, as the app's date inputs do. */
const dateOnly = (value: string | undefined) => (isDate(value) ? new Date(`${value}T00:00:00Z`) : null);

function atTime(date: string | undefined, time: string | undefined): Date | null {
  if (!isDate(date) || !time || !/^\d{1,2}:\d{2}/.test(time)) return null;
  const [h, m] = time.split(':');
  return nairobi(`${date} ${h.padStart(2, '0')}:${m}:00`);
}

function prettyDate(value: string): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function normalizeRegistration(value: string): string {
  return value.toUpperCase().replace(/\s+/g, ' ').trim();
}

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/;

// ─── Load ───────────────────────────────────────────────────────────────────────

const clients = table('client');
const clientNotes = table('clientNote');
const travelers = table('traveler');
const staff = table('staff');
const vehicles = table('vehicle');
const allTasks = table('task');
const tasks = allTasks.filter((t) => ACTIVE_STATUSES.has(t.status.trim().toLowerCase()));
const activeTaskIds = new Set(tasks.map((t) => t.id));
const journeys = table('journey').filter((j) => activeTaskIds.has(j.idTask));
const journeyStaff = table('journeyStaff');
const journeyTravelers = table('journeyTraveler');
const taskLogs = table('taskLog');
const resources = table('resourceSummary');
const documents = {
  client: table('clientDocument').map((r) => ({ owner: r.idClient, name: r.name, date: r.date })),
  staff: table('staffDocument').map((r) => ({ owner: r.idStaff, name: r.name, date: r.date })),
  traveler: table('travellerDocument').map((r) => ({ owner: r.idTraveller, name: r.name, date: r.date })),
  vehicle: table('vehicleDocument').map((r) => ({ owner: r.idVehicle, name: r.name, date: r.date })),
  task: table('taskDocument').map((r) => ({ owner: r.idTask, name: r.name, date: r.date })),
};

function documentNote(kind: keyof typeof documents, owner: string): string | null {
  const docs = documents[kind].filter((d) => d.owner === owner);
  if (docs.length === 0) return null;
  const names = docs.map((d) => [d.name || 'Unnamed file', isDate(d.date) ? `(${prettyDate(d.date)})` : ''].join(' ').trim());
  return `Documents in FileMaker, not transferred: ${names.join(', ')}`;
}

// ─── Map: lookups ───────────────────────────────────────────────────────────────

const clientById = new Map(clients.map((c) => [c.id, c]));
const taskById = new Map(tasks.map((t) => [t.id, t]));
const journeyById = new Map(journeys.map((j) => [j.id, j]));
const staffById = new Map(staff.map((s) => [s.id, s]));
const travelerById = new Map(travelers.map((t) => [t.id, t]));

const ENTITY: Record<string, string> = {
  'Lady Askari': 'LADYASKARI',
  'Lioness Alliance': 'LIONESS',
  'Stalwart Group': 'STARLLWART',
};

const TRIP_STATUS: Record<string, string> = {
  'closed out': 'Completed',
  completed: 'Completed',
  cancelled: 'Cancelled',
  canceled: 'Cancelled',
  ongoing: 'Active',
  'approved - pending task start': 'Planned',
  'confirmed - planning': 'Planned',
};

const ASSIGNMENT_STATUS: Record<string, string> = {
  Completed: 'Completed',
  Cancelled: 'Cancelled',
  Active: 'Active',
  Planned: 'Planned',
};

type Duty = 'Driver' | 'Security' | 'Support';
function dutyOf(value: string): Duty | null {
  const v = value.toLowerCase();
  if (v.includes('driver')) return 'Driver';
  if (v.includes('security')) return 'Security';
  if (v.includes('support')) return 'Support';
  return null;
}

// Staff on each journey, by duty.
const crewByJourney = new Map<string, Array<{ staffId: string; duty: Duty | null }>>();
for (const js of journeyStaff) {
  if (!js.idStaff || !journeyById.has(js.idJourney)) continue;
  const list = crewByJourney.get(js.idJourney) ?? [];
  if (!list.some((c) => c.staffId === js.idStaff)) list.push({ staffId: js.idStaff, duty: dutyOf(js.kl_designation) });
  crewByJourney.set(js.idJourney, list);
}

// Duties each person has actually done, so their roles cover their history.
const dutiesByStaff = new Map<string, Set<Duty>>();
for (const crew of crewByJourney.values()) {
  for (const c of crew) {
    if (!c.duty) continue;
    const set = dutiesByStaff.get(c.staffId) ?? new Set<Duty>();
    set.add(c.duty);
    dutiesByStaff.set(c.staffId, set);
  }
}

const travelersByJourney = new Map<string, string[]>();
for (const jt of journeyTravelers) {
  if (!jt.idTraveler || !journeyById.has(jt.idJourney)) continue;
  const list = travelersByJourney.get(jt.idJourney) ?? [];
  if (!list.includes(jt.idTraveler)) list.push(jt.idTraveler);
  travelersByJourney.set(jt.idJourney, list);
}
// Journeys whose join rows are missing still carry the IDs in a list field.
for (const j of journeys) {
  if (travelersByJourney.has(j.id) || !j.travelerIDList) continue;
  const ids = j.travelerIDList.split('\n').map((s) => s.trim()).filter((id) => travelerById.has(id));
  if (ids.length) travelersByJourney.set(j.id, [...new Set(ids)]);
}

const journeysByTask = new Map<string, Row[]>();
for (const j of journeys) {
  if (!taskById.has(j.idTask)) {
    warn(`Journey ${j.id} has no task; skipped`);
    continue;
  }
  const list = journeysByTask.get(j.idTask) ?? [];
  list.push(j);
  journeysByTask.set(j.idTask, list);
}

// ─── Map: people ────────────────────────────────────────────────────────────────

const referencedStaff = new Set([...crewByJourney.values()].flat().map((c) => c.staffId));
const referencedTravelers = new Set([...travelersByJourney.values()].flat());

const ENGAGEMENT: Record<string, string> = { consultant: 'Consultant', employee: 'Employee', contracted: 'Contractor' };

function rolesFor(s: Row): string[] {
  const roles = new Set<string>();
  const designation = s.designation.toLowerCase();
  const duties = dutiesByStaff.get(s.id) ?? new Set<Duty>();
  if (designation.includes('driver') || designation.includes('diver') || s.driverConstant || duties.has('Driver')) {
    roles.add('Driver');
  }
  if (
    designation.includes('close protection') ||
    designation === 'cpo' ||
    s.securityConstant ||
    duties.has('Security')
  ) {
    roles.add('CPO');
  }
  if (designation.includes('airport')) roles.add('Airport Greeter');
  if (designation.includes('advisor')) roles.add('Security Advisor');
  return ['Driver', 'CPO', 'Airport Greeter', 'Security Advisor'].filter((r) => roles.has(r));
}

const travelersToImport = travelers.filter((t) => referencedTravelers.has(t.id));
const normName = (value: string | undefined | null) => (value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

// ─── Map: vehicles (merging duplicate number plates) ────────────────────────────

const vehicleGroups = new Map<string, Row[]>();
for (const v of vehicles) {
  const reg = normalizeRegistration(v.registration) || `UNREGISTERED-${v.id.slice(0, 8)}`;
  vehicleGroups.set(reg, [...(vehicleGroups.get(reg) ?? []), v]);
}

const VEHICLE_TYPE_WORDS: Array<[RegExp, string]> = [
  [/truck/i, 'Truck'],
  [/van|hiace|bus/i, 'Van'],
  [/sedan|saloon/i, 'Sedan'],
  [/suv|prado|cruiser|lc ?\d|v8|gx|tx|land/i, 'SUV'],
];
function vehicleType(rows: Row[]): string {
  for (const r of rows) {
    const text = [r.type, r.model, r.make, r.name].join(' ');
    for (const [pattern, type] of VEHICLE_TYPE_WORDS) if (pattern.test(text)) return type;
  }
  return 'SUV';
}

function vehicleNotes(rows: Row[]): string | null {
  const facts = new Map<string, string>();
  const add = (label: string, value: string | undefined | null) => {
    const v = value?.trim();
    if (v && !facts.has(label)) facts.set(label, v);
  };
  for (const r of rows) {
    add('Name in FileMaker', r.name);
    add('Call sign', r.callSign);
    add('Colour', r.color);
    add('Year', r.year);
    add('Ownership', r.ownership);
    add('Hired from', [r.hiredName, r.hiredPhone, r.hiredEmail].filter(Boolean).join(', '));
    add('Hire terms', r.hiredTerms);
    add('Insurance valid until', isDate(r.insuranceValidityDate) ? prettyDate(r.insuranceValidityDate) : r.insuranceValidityDate);
    add('Last service', isDate(r.serviceDateLast) ? prettyDate(r.serviceDateLast) : r.serviceDateLast);
    add('Odometer at last service', r.kmReadingLast);
    add('Next service at (km)', r.ODOReadingNext);
    add('Location', r.locationCity);
    add('Equipment', r.equipmentList);
    add('Comments', [r.comments, r.Notes].filter(Boolean).join('\n'));
  }
  const docNotes = rows.map((r) => documentNote('vehicle', r.id)).filter(Boolean);
  return lines(...[...facts].map(([k, v]) => `${k}: ${v}`), ...docNotes);
}

// ─── Map: trips ─────────────────────────────────────────────────────────────────

const usedReferences = new Set<string>();
function referenceFor(t: Row): string {
  let ref = oneLine(t.name) ?? `FM-${t.taskNumber || t.id.slice(0, 8)}`;
  if (usedReferences.has(ref)) ref = `${ref}-${t.taskNumber || t.id.slice(0, 4)}`;
  usedReferences.add(ref);
  return ref;
}

const resourcesByTask = new Map<string, Row[]>();
for (const r of resources) {
  resourcesByTask.set(r.taskId, [...(resourcesByTask.get(r.taskId) ?? []), r]);
}

function resourceNotes(taskId: string): string | null {
  const rows = (resourcesByTask.get(taskId) ?? [])
    .filter((r) => r.resource)
    .sort((a, b) => a.date.localeCompare(b.date) || Number(a.recordNumber) - Number(b.recordNumber));
  if (rows.length === 0) return null;
  return lines(
    'Resources used (from FileMaker):',
    ...rows.map((r) =>
      [
        isDate(r.date) ? prettyDate(r.date) : 'No date',
        '·',
        r.resource,
        r.quantity && r.quantity !== '1' ? `× ${r.quantity}` : '× 1',
        r.notes ? `(${oneLine(r.notes)})` : '',
      ]
        .join(' ')
        .trim(),
    ),
  );
}

function budgetNotes(t: Row): string | null {
  const budget = [
    ['Fuel', t.budgetFuel],
    ['Per diem', t.budgetPerDiem],
    ['Car wash', t.budgetCarWash],
    ['Water', t.budgetWater],
    ['Airtime', t.budgetAirtime],
    ['Data/MiFi', t.budgetDataMiFi],
    ['Radio tracking', t.budgetRadioTracking],
    ['Parking', t.budgetParkingFees],
    ['Tolls', t.budgetTollRoadFees],
    ['Accommodation', t.budgetAccommodation],
    ['Other', t.budgetOther],
  ].filter(([, v]) => v);
  return budget.length ? `Budget: ${budget.map(([k, v]) => `${k} ${oneLine(v)}`).join('; ')}` : null;
}

/** Shortest readable form of an address for the stop title. */
function placeShort(value: string | undefined): string {
  const v = oneLine(value) ?? '?';
  const first = v.split(',')[0].trim();
  return first.length >= 3 ? first : v;
}

/** FileMaker overviews are mostly request briefs; only short one-liners read as titles. */
const isShortTitle = (overview: string) => !!overview && overview.length <= 80 && !overview.includes('\n');

/** "Journey Management – Douglas Kasambala, Daphne Kasambala +3" */
function derivedTitle(t: Row): string {
  const names = [
    ...new Set(
      (journeysByTask.get(t.id) ?? [])
        .flatMap((j) => travelersByJourney.get(j.id) ?? [])
        .map((id) => oneLine(travelerById.get(id)?.name))
        .filter((name): name is string => !!name),
    ),
  ];
  const who = names.length
    ? `${names.slice(0, 2).join(', ')}${names.length > 2 ? ` +${names.length - 2}` : ''}`
    : (oneLine(t.country) ?? oneLine(t.name));
  return [oneLine(t.serviceType) ?? 'Task', who].filter(Boolean).join(' – ');
}

function minutesBetween(a: Date | null, b: Date | null): number | null {
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 60_000);
}

/** FileMaker's end date, unless it is missing or before the start (a typo): then the last journey's date, else the start. */
function endDateFor(t: Row): Date | null {
  if (isDate(t.taskEndDate) && (!isDate(t.taskStartDate) || t.taskEndDate >= t.taskStartDate)) return dateOnly(t.taskEndDate);
  const last = (journeysByTask.get(t.id) ?? []).map((j) => j.date).filter(isDate).sort().at(-1);
  return dateOnly(last && (!isDate(t.taskStartDate) || last >= t.taskStartDate) ? last : t.taskStartDate);
}

/** Every date from start to end, as the app lays out a new trip, plus any journey date outside that range. */
function dayKeysFor(t: Row, list: Row[]): string[] {
  const keys = new Set(list.map((j) => j.date).filter(isDate));
  const start = dateOnly(t.taskStartDate);
  const end = endDateFor(t);
  if (start && end) {
    for (let d = start.getTime(), n = 0; d <= end.getTime() && n < 366; d += 86_400_000, n++) {
      keys.add(new Date(d).toISOString().slice(0, 10));
    }
  }
  return [...keys].sort();
}

// ─── Dry run report ─────────────────────────────────────────────────────────────

function report() {
  const notesLengths = tasks.map((t) => (resourceNotes(t.id) ?? '').length).sort((a, b) => b - a);
  console.log('Would import:');
  console.log(`  customers ${clients.length}, travellers ${travelersToImport.length}, trips ${tasks.length} (of ${allTasks.length} FileMaker tasks)`);
  console.log(`  journeys ${[...journeysByTask.values()].flat().length}, log entries ${taskLogs.filter((l) => taskById.has(l.taskId)).length}`);
  console.log(`  trip notes over 2,000 characters: ${notesLengths.filter((n) => n > 2000).length} (longest ${notesLengths[0] ?? 0})`);
  for (const t of tasks) {
    if (isDate(t.taskStartDate) && isDate(t.taskEndDate) && t.taskEndDate < t.taskStartDate) {
      console.log(`  NOTE ${t.name}: end ${t.taskEndDate} is before start ${t.taskStartDate}; end taken from its last journey or the start`);
    }
  }
  const statusCounts = new Map<string, number>();
  for (const t of tasks) {
    const s = TRIP_STATUS[t.status.toLowerCase()] ?? 'Planned';
    statusCounts.set(s, (statusCounts.get(s) ?? 0) + 1);
  }
  console.log(`  trip statuses: ${[...statusCounts].map(([s, n]) => `${s} ${n}`).join(', ')}`);
  const missingClients = tasks.filter((t) => !clientById.has(t.idClient)).length;
  const missingStaff = [...referencedStaff].filter((id) => !staffById.has(id)).length;
  const missingTravelers = [...referencedTravelers].filter((id) => !travelerById.has(id)).length;
  console.log(`  tasks without a known client ${missingClients}; crew without a staff record ${missingStaff}; passengers without a traveller record ${missingTravelers}`);
  if (warnings.length) console.log(`Warnings (${warnings.length}):\n  ${warnings.slice(0, 20).join('\n  ')}`);
}

// ─── Wipe ───────────────────────────────────────────────────────────────────────

/** Never deleted. Everything not listed here (or in PARTIAL) is emptied. */
const KEEP_TABLES = new Set([
  '_prisma_migrations',
  'Role',
  'Module',
  'Permission',
  'RoleModule',
  'RolePermission',
  'OrganizationSettings',
  'BrandProfile',
  'PublicHoliday',
  'AiSettings',
  'AiUsage',
  'BackupSettings',
  'UploadLimitSettings',
  'MessagingAccount',
  'MessagingChat',
  'MessagingMessage',
  'WhatsAppMessage',
  'ExchangeRateSnapshot',
  'RateLimitBucket',
  // Users and their access
  'User',
  'UserRole',
  'UserModule',
  'UserGroup',
  'UserGroupMember',
  'Session',
  'Device',
  'DeviceChallenge',
  'AuditLog',
  // Settings and integrations
  'QuickBooksConnection',
  'WaveConnection',
  'MessagingAccountGroupShare',
  'QuoteTemplate',
  'QuoteSequence',
  'InvoiceSequence',
  'BackupRun',
  // Shift planning, untouched
  'ShiftConfig',
  'ShiftLine',
  'ShiftMonth',
  'ShiftRecord',
  'ShiftCallIn',
  'ShiftLeave',
  'ShiftCto',
  'ShiftNotice',
  'ShiftAudit',
  // Reference lists
  'Product',
  'ServiceCatalogImport',
  'Personnel',
  'Driver',
  'Officer',
  'DriverLicense',
  'Vehicle',
  'VehicleFuelLog',
  'VehicleMaintenance',
  'VehicleMaintenanceNotification',
  'Vendor',
  'VendorService',
  'MapCategory',
  'MapLayer',
  'MapFeature',
  'MapGeofence',
  'MapDeviceTag',
]);

async function wipe() {
  const tables = (
    await prisma.$queryRaw<Array<{ tablename: string }>>`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
  ).map((t) => t.tablename);
  const toEmpty = tables.filter((t) => !KEEP_TABLES.has(t));
  // No CASCADE: if a kept table still points at an emptied one, fail rather than spill into it.
  await prisma.$executeRawUnsafe(`TRUNCATE ${toEmpty.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY`);
  console.log(`Emptied ${toEmpty.length} tables: ${toEmpty.join(', ')}`);
}

// ─── Import ─────────────────────────────────────────────────────────────────────

/** createManyAndReturn gives rows back in insert order; prove it before relying on it. */
function assertSameOrder(label: string, expected: string[], created: Array<{ name: string }>) {
  if (created.length !== expected.length || created.some((row, i) => row.name !== expected[i])) {
    throw new Error(`${label}: returned rows are not in insert order`);
  }
}

async function inBatches<T, R>(rows: T[], size: number, run: (batch: T[]) => Promise<R[]>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < rows.length; i += size) out.push(...(await run(rows.slice(i, i + size))));
  return out;
}

async function importAll(adminId: number) {
  // Customers
  const tasksByClient = new Map<string, Row[]>();
  for (const t of tasks) tasksByClient.set(t.idClient, [...(tasksByClient.get(t.idClient) ?? []), t]);
  const entityFor = (clientId: string) => {
    const counts = new Map<string, number>();
    for (const t of tasksByClient.get(clientId) ?? []) {
      const e = ENTITY[t.contractEntity];
      if (e) counts.set(e, (counts.get(e) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'LADYASKARI';
  };
  const createdCustomers = await prisma.customer.createManyAndReturn({
    data: clients.map((c) => ({
      name: oneLine(c.name) ?? 'Unnamed client',
      email: EMAIL.exec(c.email)?.[0] ?? null,
      phone: oneLine(c.phone),
      address: orNull(c.address),
      entity: entityFor(c.id),
      createdById: adminId,
      createdAt: nairobi(c.timestampCreation) ?? undefined,
      updatedAt: nairobi(c.timestampModification) ?? undefined,
    })),
    select: { id: true, name: true },
  });
  assertSameOrder('customers', clients.map((c) => oneLine(c.name) ?? 'Unnamed client'), createdCustomers);
  const customerId = new Map(clients.map((c, i) => [c.id, createdCustomers[i].id]));

  // Contacts from the POC fields, and the client profile as a CRM note.
  const contacts: Prisma.ContactCreateManyInput[] = [];
  const crmNotes: Prisma.CrmActivityCreateManyInput[] = [];
  for (const c of clients) {
    const id = customerId.get(c.id)!;
    const pocs = new Map<string, string[]>();
    for (const [field, role] of [
      ['operationalPOC', 'Operations contact'],
      ['financialPOC', 'Finance contact'],
    ] as const) {
      const raw = oneLine(c[field]);
      if (raw) pocs.set(raw, [...(pocs.get(raw) ?? []), role]);
    }
    for (const [raw, roles] of pocs) {
      const email = EMAIL.exec(raw)?.[0] ?? null;
      const name = clip(raw.replace(EMAIL, '').replace(/\s+/g, ' ').trim() || raw, 160);
      contacts.push({
        name,
        role: roles.join(' & '),
        category: 'Client',
        email,
        customerId: id,
        notes: 'Imported from FileMaker',
        createdById: adminId,
      });
    }
    const profile = lines(
      c.clientCode && `Client code: ${c.clientCode}`,
      c.website && `Website: ${c.website}`,
      c.relationshipManager && `Relationship manager: ${c.relationshipManager}`,
      c.clientOverview,
      c.contractTermsAndConditions && `Contract terms: ${c.contractTermsAndConditions}`,
      documentNote('client', c.id),
    );
    if (profile) {
      crmNotes.push({
        customerId: id,
        type: 'note',
        summary: `From FileMaker\n${profile}`,
        occurredAt: nairobi(c.timestampCreation) ?? new Date(),
        createdById: adminId,
      });
    }
  }
  for (const n of clientNotes) {
    const id = customerId.get(n.idClient);
    if (!id || !n.note) continue;
    crmNotes.push({
      customerId: id,
      type: 'note',
      summary: n.note,
      occurredAt: dateOnly(n.date) ?? nairobi(n.timestampCreation) ?? new Date(),
      createdById: adminId,
    });
  }
  await prisma.contact.createMany({ data: contacts });
  await prisma.crmActivity.createMany({ data: crmNotes });

  // Travellers
  const createdTravelers = await inBatches(travelersToImport, 500, (batch) =>
    prisma.traveler.createManyAndReturn({
      data: batch.map((t) => ({
        name: oneLine(t.name) ?? 'Unnamed traveller',
        customerId: customerId.get(t.idClient) ?? null,
        email: EMAIL.exec(t.email)?.[0] ?? null,
        phone: oneLine(t.phone),
        medicalNotes: orNull(t.knownMedicalIssues),
        notes: lines(
          t.details,
          t.travelerPreferences && `Preferences: ${t.travelerPreferences}`,
          t.primaryContactMethod && `Preferred contact: ${t.primaryContactMethod}`,
          t.socialProfileUrl && `Profile: ${t.socialProfileUrl}`,
          t.gender && `Gender: ${t.gender}`,
          documentNote('traveler', t.id),
        ),
        createdById: adminId,
        createdAt: nairobi(t.timestampCreation) ?? undefined,
        updatedAt: nairobi(t.timestampModification) ?? undefined,
      })),
      select: { id: true, name: true },
    }),
  );
  assertSameOrder('travellers', travelersToImport.map((t) => oneLine(t.name) ?? 'Unnamed traveller'), createdTravelers);
  const travelerId = new Map(travelersToImport.map((t, i) => [t.id, createdTravelers[i].id]));

  // Crew and vehicles: link to the Driver/Officer/Vehicle rows the app already has.
  const [existingDrivers, existingOfficers, existingVehicles] = await Promise.all([
    prisma.driver.findMany({ select: { id: true, name: true, retiredAt: true }, orderBy: { id: 'asc' } }),
    prisma.officer.findMany({ select: { id: true, name: true, retiredAt: true }, orderBy: { id: 'asc' } }),
    prisma.vehicle.findMany({ select: { id: true, registration: true } }),
  ]);
  const byName = (rows: Array<{ id: number; name: string; retiredAt: Date | null }>) => {
    const map = new Map<string, number>();
    // Active profiles win over retired ones of the same name.
    for (const r of [...rows].sort((a, b) => Number(!!b.retiredAt) - Number(!!a.retiredAt))) map.set(normName(r.name), r.id);
    return map;
  };
  const driverByName = byName(existingDrivers);
  const officerByName = byName(existingOfficers);
  const driverIdByStaff = new Map<string, number | null>();
  const officerIdByStaff = new Map<string, number | null>();
  const unmatchedCrew = new Set<string>();
  for (const crew of crewByJourney.values()) {
    for (const c of crew) {
      const name = normName(staffById.get(c.staffId)?.name);
      const d = driverByName.get(name) ?? null;
      const o = officerByName.get(name) ?? null;
      driverIdByStaff.set(c.staffId, d);
      officerIdByStaff.set(c.staffId, o);
      if ((c.duty === 'Driver' && !d) || (c.duty === 'Security' && !o)) unmatchedCrew.add(`${c.duty}: ${oneLine(staffById.get(c.staffId)?.name) ?? c.staffId}`);
    }
  }
  const vehicleIdByRegistration = new Map(existingVehicles.map((v) => [normalizeRegistration(v.registration), v.id]));
  const vehicleId = new Map<string, number>();
  const unmatchedVehicles = new Set<string>();
  for (const j of journeys) {
    const v = vehicles.find((row) => row.id === j.idVehicle);
    if (!v) continue;
    const id = vehicleIdByRegistration.get(normalizeRegistration(v.registration));
    if (id) vehicleId.set(v.id, id);
    else unmatchedVehicles.add(normalizeRegistration(v.registration) || v.id);
  }
  const vehicleLabel = new Map(
    vehicles.map((v) => [v.id, [normalizeRegistration(v.registration), oneLine(v.make) ?? oneLine(v.name), oneLine(v.model)].filter(Boolean).join(' · ')]),
  );

  // Trips
  const trackingByYear = new Map<number, number>();
  const tripRows = tasks.filter((t) => customerId.has(t.idClient));
  const tripReferences = tripRows.map(referenceFor);
  const createdTrips = await inBatches(tripRows, 500, (batch) =>
    prisma.trip.createManyAndReturn({
      data: batch.map((t) => {
        const created = nairobi(t.timestampCreation) ?? new Date();
        const year = dateOnly(t.taskStartDate)?.getUTCFullYear() ?? created.getUTCFullYear();
        const seq = (trackingByYear.get(year) ?? 0) + 1;
        trackingByYear.set(year, seq);
        const titleFromOverview = isShortTitle(t.taskOverview);
        const title = clip(titleFromOverview ? oneLine(t.taskOverview)! : derivedTitle(t), 200);
        return {
          reference: tripReferences[tripRows.indexOf(t)],
          trackingCode: `LA-${year}-${String(seq).padStart(4, '0')}`,
          customerId: customerId.get(t.idClient)!,
          createdById: adminId,
          title,
          description: clipOrNull(
            lines(
              [
                t.taskNumber && `FileMaker task ${t.taskNumber}`,
                t.serviceType,
                t.country,
                t.contractEntity && t.contractEntity !== 'Lady Askari' ? `Contract: ${t.contractEntity}` : null,
              ]
                .filter(Boolean)
                .join(' · '),
              titleFromOverview ? null : t.taskOverview,
              budgetNotes(t),
              documentNote('task', t.id),
            ),
            10000,
          ),
          status: TRIP_STATUS[t.status.toLowerCase()] ?? 'Planned',
          startDate: dateOnly(t.taskStartDate),
          endDate: endDateFor(t),
          currency: /kenya/i.test(t.currency) ? 'KES' : 'USD',
          notes: resourceNotes(t.id),
          createdAt: created,
          updatedAt: nairobi(t.timestampModification) ?? created,
        };
      }),
      select: { id: true, reference: true, status: true, createdAt: true },
    }),
  );
  const tripByReference = new Map(createdTrips.map((t) => [t.reference, t]));
  const tripByTask = new Map(tripRows.map((t, i) => [t.id, tripByReference.get(tripReferences[i])!]));

  // Days and transport stops
  const dayRows: Prisma.TripDayCreateManyInput[] = [];
  const dayKeyOf: Array<{ tripId: number; dateKey: string }> = [];
  for (const t of tripRows) {
    const trip = tripByTask.get(t.id);
    if (!trip) continue;
    const dates = dayKeysFor(t, journeysByTask.get(t.id) ?? []);
    dates.forEach((dateKey, i) => {
      dayRows.push({ tripId: trip.id, dateKey, dayNumber: i + 1, createdAt: trip.createdAt });
      dayKeyOf.push({ tripId: trip.id, dateKey });
    });
  }
  const createdDays = await inBatches(dayRows, 1000, (batch) =>
    prisma.tripDay.createManyAndReturn({ data: batch, select: { id: true, tripId: true, dateKey: true } }),
  );
  const dayId = new Map(createdDays.map((d) => [`${d.tripId}|${d.dateKey}`, d.id]));

  const staffName = (id: string) => oneLine(staffById.get(id)?.name) ?? null;
  const itemRows: Prisma.TripItineraryItemCreateManyInput[] = [];
  for (const [taskId, list] of journeysByTask) {
    const trip = tripByTask.get(taskId);
    if (!trip) continue;
    const ordered = [...list].sort(
      (a, b) =>
        (a.date || '9999').localeCompare(b.date || '9999') ||
        (a.pickupTime || '99').localeCompare(b.pickupTime || '99') ||
        a.timestampCreation.localeCompare(b.timestampCreation),
    );
    ordered.forEach((j, position) => {
      const crew = crewByJourney.get(j.id) ?? [];
      const named = (duty: Duty) => crew.filter((c) => c.duty === duty).map((c) => staffName(c.staffId)).filter(Boolean);
      const drivers = named('Driver').length ? named('Driver') : (j.staffDriversNameList || '').split('\n').filter(Boolean);
      const security = named('Security').length ? named('Security') : (j.staffSecurityNameList || '').split('\n').filter(Boolean);
      const support = named('Support').length ? named('Support') : (j.staffSupportNameList || '').split('\n').filter(Boolean);
      const passengers = (travelersByJourney.get(j.id) ?? [])
        .map((id) => oneLine(travelerById.get(id)?.name))
        .filter(Boolean);
      const passengerNames = passengers.length ? passengers : (j.travelerNameList || '').split('\n').filter(Boolean);
      const firstDriver = crew.find((c) => c.duty === 'Driver');
      const start = atTime(j.date, j.pickupTime);
      let end = atTime(j.date, j.arrivalTime);
      if (start && end && end < start) end = new Date(end.getTime() + 86_400_000);
      const vehicle = vehicleLabel.get(j.idVehicle) ?? oneLine(j.vehicleLookup);
      itemRows.push({
        tripId: trip.id,
        dayId: isDate(j.date) ? dayId.get(`${trip.id}|${j.date}`) : null,
        position,
        itemType: 'car',
        category: 'transportation',
        description: clip(`${placeShort(j.pickupLocation)} → ${placeShort(j.dropoffLocation)}`, 200),
        timeLabel: 'PICK-UP',
        body: clipOrNull(
          lines(
            passengerNames.length ? `Passengers: ${passengerNames.join(', ')}` : null,
            security.length ? `Security: ${security.join(', ')}` : null,
            support.length ? `Support: ${support.join(', ')}` : null,
            j.notes,
            j.journeyDistance && `Route: ${[j.journeyDistance, j.journeyDuration, j.journeyPreference].filter(Boolean).join(' · ')}`,
          ),
          6000,
        ),
        details: {
          // The Standardized Naming Master's names, as the 2026-10-27 migration relabelled them.
          mode: transportTypeForRoute([oneLine(j.pickupLocation), oneLine(j.dropoffLocation)]),
          ...(vehicle ? { vehicle: clip(vehicle, 200) } : {}),
          ...(j.pickupLocation ? { pickupLocation: clip(oneLine(j.pickupLocation)!, 200) } : {}),
          ...(j.dropoffLocation ? { dropoffLocation: clip(oneLine(j.dropoffLocation)!, 200) } : {}),
          ...(drivers.length ? { driverName: clip(drivers.join(', '), 200) } : {}),
          ...(firstDriver && staffById.get(firstDriver.staffId)?.phone
            ? { driverPhone: clip(oneLine(staffById.get(firstDriver.staffId)!.phone)!, 200) }
            : {}),
        },
        quantity: new Prisma.Decimal(1),
        scheduledAt: start,
        endsAt: end,
        durationMinutes: minutesBetween(start, end),
      });
    });
  }
  await inBatches(itemRows, 1000, async (batch) => {
    await prisma.tripItineraryItem.createMany({ data: batch });
    return [];
  });

  // Travellers on each trip
  const tripTravelerRows: Prisma.TripTravelerCreateManyInput[] = [];
  for (const [taskId, list] of journeysByTask) {
    const trip = tripByTask.get(taskId);
    if (!trip) continue;
    const ids = new Set(list.flatMap((j) => travelersByJourney.get(j.id) ?? []));
    for (const fmId of ids) {
      const id = travelerId.get(fmId);
      if (id) tripTravelerRows.push({ tripId: trip.id, travelerId: id, createdAt: trip.createdAt });
    }
  }
  await inBatches(tripTravelerRows, 2000, async (batch) => {
    await prisma.tripTraveler.createMany({ data: batch, skipDuplicates: true });
    return [];
  });

  // Assignments: each driver with the vehicle they drove most, each CPO, and
  // any vehicle no driver row covers.
  const assignmentRows: Prisma.TripAssignmentCreateManyInput[] = [];
  for (const [taskId, list] of journeysByTask) {
    const trip = tripByTask.get(taskId);
    if (!trip) continue;
    const status = ASSIGNMENT_STATUS[trip.status] ?? 'Planned';
    const driverVehicles = new Map<string, Map<string, number>>();
    const officers = new Set<string>();
    const vehiclesUsed = new Set<number>();
    for (const j of list) {
      const v = vehicleId.get(j.idVehicle);
      if (v) vehiclesUsed.add(v);
      for (const c of crewByJourney.get(j.id) ?? []) {
        if (c.duty === 'Driver') {
          const counts = driverVehicles.get(c.staffId) ?? new Map<string, number>();
          if (j.idVehicle) counts.set(j.idVehicle, (counts.get(j.idVehicle) ?? 0) + 1);
          driverVehicles.set(c.staffId, counts);
        } else if (c.duty === 'Security') officers.add(c.staffId);
      }
    }
    const covered = new Set<number>();
    for (const [staffId, counts] of driverVehicles) {
      const driverId = driverIdByStaff.get(staffId) ?? null;
      if (!driverId) continue;
      const topVehicle = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
      const v = topVehicle ? (vehicleId.get(topVehicle) ?? null) : null;
      if (v) covered.add(v);
      assignmentRows.push({ tripId: trip.id, driverId, vehicleId: v, status, createdById: adminId, createdAt: trip.createdAt });
    }
    for (const staffId of officers) {
      const officerId = officerIdByStaff.get(staffId) ?? null;
      if (officerId) assignmentRows.push({ tripId: trip.id, officerId, status, createdById: adminId, createdAt: trip.createdAt });
    }
    for (const v of vehiclesUsed) {
      if (!covered.has(v)) assignmentRows.push({ tripId: trip.id, vehicleId: v, status, createdById: adminId, createdAt: trip.createdAt });
    }
  }
  await inBatches(assignmentRows, 2000, async (batch) => {
    await prisma.tripAssignment.createMany({ data: batch });
    return [];
  });

  // Operations log
  const logRows: Prisma.TripLogEntryCreateManyInput[] = [];
  for (const l of taskLogs) {
    const trip = tripByTask.get(l.taskId);
    if (!trip) continue;
    const loggedAt = atTime(l.logDate, l.logTime) ?? nairobi(l.timestampCreation) ?? trip.createdAt;
    logRows.push({
      tripId: trip.id,
      loggedAt,
      detail: l.detailReceived || '(no detail recorded)',
      receivedFrom: oneLine(l.detailReceivedBy),
      actionItem: orNull(l.actionItem),
      dutyController: oneLine(l.dutyController),
      comments: orNull(l.comments),
      escalated: l.escalate === '1',
      createdAt: nairobi(l.timestampCreation) ?? loggedAt,
      updatedAt: nairobi(l.timestampModification) ?? loggedAt,
    });
  }
  await inBatches(logRows, 2000, async (batch) => {
    await prisma.tripLogEntry.createMany({ data: batch });
    return [];
  });

  // New trips continue the tracking numbers after the imported ones.
  for (const [year, lastNumber] of trackingByYear) {
    await prisma.trackingSequence.upsert({ where: { year }, create: { year, lastNumber }, update: { lastNumber } });
  }

  console.log('Imported:');
  console.log(`  customers ${createdCustomers.length}, contacts ${contacts.length}, CRM notes ${crmNotes.length}`);
  console.log(`  travellers ${createdTravelers.length}`);
  console.log(`  trips ${createdTrips.length}, days ${createdDays.length}, stops ${itemRows.length}`);
  console.log(`  trip travellers ${tripTravelerRows.length}, assignments ${assignmentRows.length}, log entries ${logRows.length}`);
  if (unmatchedCrew.size) console.log(`  crew with no Driver/Officer record (left as text on the stops): ${[...unmatchedCrew].join('; ')}`);
  if (unmatchedVehicles.size) console.log(`  vehicles with no Vehicle record (left as text on the stops): ${[...unmatchedVehicles].join(', ')}`);
}

async function main() {
  report();
  if (DRY_RUN) return;

  const admins = await prisma.user.findMany({
    where: { userRoles: { some: { role: { name: 'admin' } } } },
    select: { id: true, email: true },
    orderBy: { id: 'asc' },
  });
  if (admins.length === 0) throw new Error('No admin account found; refusing to wipe.');
  // The first admin owns the imported records.
  await wipe();
  await importAll(admins[0].id);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
