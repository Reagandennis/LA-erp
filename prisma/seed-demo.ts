/**
 * Demo data for local development.
 *
 *   SEED_DEMO=1 npm run db:seed:demo
 *
 * Builds a coherent, fictional dataset around a Nairobi executive-protection
 * business so every module has something to show: team and roles, clients and
 * pipeline, quotes with correct totals, invoices and payments, trips with
 * itineraries and assignments, fleet and licences, contracts, schedules,
 * SOPs, handovers, messages, files and map data. Dates are relative to today
 * so "upcoming" and "expiring soon" views stay meaningful.
 *
 * Safety: refuses to run without SEED_DEMO=1, refuses non-local databases
 * unless SEED_DEMO_ALLOW_REMOTE=1, and refuses to run twice (reset the local
 * database with `npx prisma migrate reset` to start over). Requires the base
 * seed (`npm run db:seed`) to have created roles, modules and the admin.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const DEMO_DOMAIN = 'ladyaskari-demo.test';
const DEMO_PASSWORD = 'Demo1234!';

// ---------------------------------------------------------------- helpers

const DAY = 24 * 60 * 60 * 1000;
const now = new Date();
const year = now.getUTCFullYear();

/** A date `days` from now at the given local hour (default 09:00). */
function at(days: number, hour = 9, minute = 0): Date {
  const d = new Date(now.getTime() + days * DAY);
  d.setHours(hour, minute, 0, 0);
  return d;
}
function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function pad4(n: number): string {
  return String(n).padStart(4, '0');
}

type LineInput = {
  description: string;
  quantity: number;
  days?: number;
  unitPrice: number;
  taxable?: boolean;
  productId?: number | null;
};

/** Mirrors lib/quotes.ts computeLine/computeQuoteTotals (no line discounts here). */
function totals(items: LineInput[], taxRate: number, discount: { type: 'none' | 'percentage' | 'fixed'; value: number } = { type: 'none', value: 0 }) {
  const lines = items.map((item, position) => {
    const days = item.days ?? 1;
    const total = round2(item.quantity * days * item.unitPrice);
    return { ...item, days, taxable: item.taxable ?? true, position, total };
  });
  const subtotal = round2(lines.reduce((acc, l) => acc + l.total, 0));
  const taxable = lines.reduce((acc, l) => (l.taxable ? acc + l.total : acc), 0);
  const tax = round2(taxable * taxRate);
  const preDiscount = round2(subtotal + tax);
  let discountAmount = 0;
  if (discount.type === 'percentage') discountAmount = round2((preDiscount * discount.value) / 100);
  if (discount.type === 'fixed') discountAmount = round2(Math.min(discount.value, preDiscount));
  return { lines, subtotal, tax, discountAmount, total: round2(preDiscount - discountAmount) };
}

function assertLocalDatabase() {
  if (process.env.SEED_DEMO !== '1') {
    throw new Error('Refusing to seed demo data: set SEED_DEMO=1 to confirm.');
  }
  const url = process.env.DATABASE_URL ?? '';
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error('DATABASE_URL is missing or not a URL.');
  }
  const local = ['localhost', '127.0.0.1', '::1', 'postgres', 'db'].includes(host);
  if (!local && process.env.SEED_DEMO_ALLOW_REMOTE !== '1') {
    throw new Error(`Refusing to seed demo data into non-local database host "${host}" (set SEED_DEMO_ALLOW_REMOTE=1 to override).`);
  }
}

// ---------------------------------------------------------------- data

const PEOPLE = [
  { name: 'Amina Wanjiru', role: 'Operations Manager', department: 'Operations', roleName: 'editor', phone: '+254 722 110 231', skills: ['Route planning', 'Client liaison', 'Incident command'] },
  { name: 'Daniel Otieno', role: 'Finance Lead', department: 'Finance', roleName: 'editor', phone: '+254 733 448 902', skills: ['Invoicing', 'QuickBooks', 'Reporting'] },
  { name: 'Grace Mwangi', role: 'Sales & Accounts', department: 'Sales', roleName: 'editor', phone: '+254 711 905 317', skills: ['Proposals', 'CRM', 'Negotiation'] },
  { name: 'Peter Kamau', role: 'Security Advisor', department: 'Security', roleName: 'viewer', phone: '+254 720 663 540', skills: ['Threat assessment', 'Advance work', 'First aid'] },
  { name: 'Faith Njeri', role: 'HR & Administration', department: 'Human Resources', roleName: 'viewer', phone: '+254 700 212 877', skills: ['Onboarding', 'Scheduling', 'Compliance'] },
];

const EDITOR_MODULES = [
  'todo-personal', 'handover', 'calendar', 'map', 'task-list', 'personnel', 'drivers', 'cpos', 'airport-greeters',
  'security-advisors', 'travelers', 'vendors-suppliers', 'communication', 'notes', 'file-upload', 'ai-chatbot',
  'vehicles', 'contact-list', 'sops', 'quotes', 'customers', 'products-services', 'reports', 'feedback', 'clock',
  'notification-center', 'drivers-license-expiry', 'contract-renewal', 'invoices-review', 'sales-metrics',
  'finance-metrics', 'clock-in-out', 'shift-planning', 'weather', 'flight-tracker', 'trip-planning',
  'task-assignment', 'intel', 'kpis',
];
const VIEWER_MODULES = [
  'todo-personal', 'handover', 'calendar', 'map', 'communication', 'notes', 'sops', 'clock', 'clock-in-out',
  'shift-planning', 'weather', 'notification-center', 'feedback', 'vehicles', 'personnel',
];

const FIELD_STAFF = [
  { name: 'Joseph Mutua', roles: ['Driver'], phone: '+254 721 334 118', license: 'DL-4471-KE', licenseCategory: 'Class B', licenseExpiryDays: 420 },
  { name: 'Samuel Kiprotich', roles: ['Driver'], phone: '+254 724 877 265', license: 'DL-5120-KE', licenseCategory: 'Commercial', licenseExpiryDays: 23 },
  { name: 'Mercy Achieng', roles: ['Driver', 'CPO'], phone: '+254 712 650 904', license: 'DL-6630-KE', licenseCategory: 'Class B', licenseExpiryDays: 190, grade: 'Driver/CPO', callSign: 'Kite 4' },
  { name: 'Brian Omondi', roles: ['Driver'], phone: '+254 733 219 087', license: 'DL-7014-KE', licenseCategory: 'Class A', licenseExpiryDays: -12 },
  { name: 'Hassan Abdi', roles: ['CPO'], phone: '+254 722 908 416', grade: 'Team Leader', callSign: 'Kite 1' },
  { name: 'Lucy Wambui', roles: ['CPO'], phone: '+254 713 442 970', grade: 'CPO', callSign: 'Kite 2' },
  { name: 'George Kimani', roles: ['CPO'], phone: '+254 725 118 362', grade: 'Detail Leader', callSign: 'Kite 3' },
  { name: 'Esther Nyambura', roles: ['CPO'], phone: '+254 710 377 509', grade: 'CPO', callSign: 'Kite 5' },
  { name: 'Victor Barasa', roles: ['Airport Greeter'], phone: '+254 729 603 284' },
  { name: 'Naomi Chebet', roles: ['Airport Greeter'], phone: '+254 718 541 096' },
  { name: 'Ali Mohamed', roles: ['Security Advisor'], phone: '+254 722 775 130', engagement: 'Consultant', supplierName: 'Coastline Risk Advisory' },
];

const VEHICLES = [
  { registration: 'KDA 123A', make: 'Toyota', model: 'Land Cruiser 300', type: 'Armoured', status: 'Available', capacity: 4, notes: 'B6 armour. Run-flat tyres fitted March.' },
  { registration: 'KCY 456B', make: 'Toyota', model: 'Land Cruiser Prado', type: 'SUV', status: 'Assigned', capacity: 6 },
  { registration: 'KDJ 789C', make: 'Mercedes-Benz', model: 'E 300', type: 'Sedan', status: 'Available', capacity: 3 },
  { registration: 'KBZ 321D', make: 'Toyota', model: 'Hiace', type: 'Van', status: 'Available', capacity: 12 },
  { registration: 'KDE 654E', make: 'Land Rover', model: 'Range Rover Sport', type: 'SUV', status: 'Maintenance', capacity: 4, notes: 'Brake pads and tracker battery due.' },
  { registration: 'KDK 987F', make: 'Toyota', model: 'Fortuner', type: 'SUV', status: 'Available', capacity: 6 },
];

const CUSTOMERS = [
  { name: 'Kilimani Capital Partners', company: 'Kilimani Capital Partners LLP', email: 'ops@kilimanicapital.test', phone: '+254 20 445 0101', address: 'Riverside Drive, Nairobi', entity: 'LADYASKARI', contacts: [{ name: 'Wanjiku Ndung’u', role: 'Executive Assistant' }, { name: 'Tom Barrett', role: 'Managing Partner' }] },
  { name: 'Meridian Mining Ltd', company: 'Meridian Mining Ltd', email: 'security@meridianmining.test', phone: '+254 41 222 3340', address: 'Nyali, Mombasa', entity: 'LADYASKARI', contacts: [{ name: 'Rose Akinyi', role: 'Country Security Manager' }] },
  { name: 'Savannah Broadcasting Group', company: 'Savannah Broadcasting Group', email: 'productions@savannahbg.test', phone: '+254 20 271 8800', address: 'Westlands, Nairobi', entity: 'LIONESS', contacts: [{ name: 'Kevin Oduya', role: 'Head of Productions' }, { name: 'Sheila Muthoni', role: 'Logistics Coordinator' }] },
  { name: 'Aurora Health Foundation', company: 'Aurora Health Foundation', email: 'travel@aurorahealth.test', phone: '+41 22 900 1100', address: 'Geneva, Switzerland', entity: 'LADYASKARI', contacts: [{ name: 'Dr. Lena Fischer', role: 'Programme Director' }] },
  { name: 'Blue Horizon Logistics', company: 'Blue Horizon Logistics EA', email: 'fleet@bluehorizon.test', phone: '+254 20 650 7720', address: 'Industrial Area, Nairobi', entity: 'STARLLWART', contacts: [{ name: 'Mark Wekesa', role: 'Operations Director' }] },
  { name: 'Northstar Energy Kenya', company: 'Northstar Energy Kenya Ltd', email: 'hse@northstar.test', phone: '+254 20 371 2200', address: 'Upper Hill, Nairobi', entity: 'LADYASKARI', contacts: [{ name: 'Priya Shah', role: 'HSE Manager' }, { name: 'James Mwai', role: 'Site Lead, Turkana' }] },
  { name: 'Crescent Hospitality Group', company: 'Crescent Hospitality Group', email: 'gm@crescenthg.test', phone: '+254 20 495 3030', address: 'Karen, Nairobi', entity: 'LIONESS', contacts: [{ name: 'Fatma Said', role: 'General Manager' }] },
  { name: 'Westlands Tech Hub', company: 'Westlands Tech Hub Ltd', email: 'admin@wth.test', phone: '+254 20 203 4040', address: 'Parklands, Nairobi', entity: 'STARLLWART', contacts: [{ name: 'Collins Mburu', role: 'Facilities Manager' }] },
];

const PRODUCTS = [
  { name: 'Close protection officer (per day)', sku: 'CPO-DAY', defaultUnitPrice: 350, description: 'Licensed CPO, 12-hour detail including briefing and debrief.' },
  { name: 'Armoured vehicle with driver (per day)', sku: 'ARM-DAY', defaultUnitPrice: 650, description: 'B6 armoured SUV, security driver, fuel within Nairobi.' },
  { name: 'SUV with security driver (per day)', sku: 'SUV-DAY', defaultUnitPrice: 220 },
  { name: 'Airport meet & greet', sku: 'APT-MG', defaultUnitPrice: 90, description: 'Fast-track facilitation and escort to vehicle at JKIA or Moi International.' },
  { name: 'Route reconnaissance', sku: 'RECCE', defaultUnitPrice: 400, description: 'Advance route and venue survey with written report.' },
  { name: 'Security advisory (per hour)', sku: 'ADV-HR', defaultUnitPrice: 120 },
  { name: 'Secure transfer (per trip)', sku: 'XFER', defaultUnitPrice: 150 },
  { name: 'Overnight deployment surcharge', sku: 'OVN', defaultUnitPrice: 80, taxable: false },
];

// ---------------------------------------------------------------- main

async function main() {
  assertLocalDatabase();

  const marker = await prisma.user.findFirst({ where: { email: { endsWith: `@${DEMO_DOMAIN}` } } });
  if (marker) {
    console.log('Demo data is already present (found a demo user). Reset the local database to re-seed.');
    return;
  }

  const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const admin = adminEmail ? await prisma.user.findUnique({ where: { email: adminEmail } }) : null;
  if (!admin) throw new Error('Bootstrap admin not found. Run `npm run db:seed` first.');
  const roles = await prisma.role.findMany();
  const modules = await prisma.module.findMany();
  if (roles.length === 0 || modules.length === 0) throw new Error('Roles/modules missing. Run `npm run db:seed` first.');
  const roleId = (name: string) => {
    const r = roles.find((x) => x.name === name);
    if (!r) throw new Error(`Role ${name} missing`);
    return r.id;
  };
  const moduleId = new Map(modules.map((m) => [m.slug, m.id]));

  // ---- users ----------------------------------------------------------
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const users: Record<string, { id: number; name: string; email: string }> = {};
  for (const p of PEOPLE) {
    const email = `${p.name.toLowerCase().replace(/[^a-z]+/g, '.')}@${DEMO_DOMAIN}`;
    const user = await prisma.user.create({
      data: {
        email,
        name: p.name,
        passwordHash,
        status: 'active',
        worldClockZones: ['Africa/Nairobi', 'Europe/London', 'Asia/Dubai'],
        dashboardHighlights: ['quotes', 'trip-planning', 'calendar'],
        userRoles: { create: { roleId: roleId(p.roleName) } },
        userModules: {
          create: (p.roleName === 'editor' ? EDITOR_MODULES : VIEWER_MODULES)
            .filter((slug) => moduleId.has(slug))
            .map((slug) => ({ moduleId: moduleId.get(slug)! })),
        },
      },
    });
    users[p.name] = user;
  }
  const amina = users['Amina Wanjiru'];
  const daniel = users['Daniel Otieno'];
  const grace = users['Grace Mwangi'];
  const peter = users['Peter Kamau'];
  const faith = users['Faith Njeri'];
  const staffUsers = [amina, daniel, grace, peter, faith];
  console.log(`users: ${staffUsers.length} (password for all demo users: ${DEMO_PASSWORD})`);

  // ---- organisation + brand -------------------------------------------
  await prisma.organizationSettings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      companyName: 'Lady Askari Limited',
      addressLine1: 'Mwanzi Road, Westlands',
      city: 'Nairobi',
      country: 'Kenya',
      email: 'ops@ladyaskari-demo.test',
      phone: '+254 20 123 4567',
      website: 'https://ladyaskari-demo.test',
      defaultCurrency: 'USD',
      defaultTaxRate: 0.16,
      taxLabel: 'VAT',
      updatedById: admin.id,
    },
  });
  const brand = await prisma.brandProfile.create({
    data: {
      name: 'Lady Askari',
      companyName: 'Lady Askari Limited',
      addressLine1: 'Mwanzi Road, Westlands',
      city: 'Nairobi',
      country: 'Kenya',
      email: 'ops@ladyaskari-demo.test',
      phone: '+254 20 123 4567',
      website: 'https://ladyaskari-demo.test',
      primaryColor: '#03458f',
      isDefault: true,
      createdById: admin.id,
    },
  });
  await prisma.brandProfile.create({
    data: { name: 'Lioness Alliance', companyName: 'Lioness Alliance Ltd', city: 'Nairobi', country: 'Kenya', primaryColor: '#9a3412', createdById: admin.id },
  });

  // ---- personnel, drivers, officers, licences ---------------------------
  const personnelByName: Record<string, number> = {};
  const driverIds: number[] = [];
  const officerIds: number[] = [];
  type StaffSpec = {
    name: string; roles: string[]; phone: string; role: string; department: string; skills: string[];
    userId?: number; engagement?: string; supplierName?: string; grade?: string; callSign?: string;
  };
  const staffPersonnel: StaffSpec[] = [
    ...PEOPLE.map((p, i) => ({ name: p.name, roles: [], phone: p.phone, role: p.role, department: p.department, skills: p.skills, userId: staffUsers[i].id })),
    ...FIELD_STAFF.map((f) => {
      const extra = f as { engagement?: string; supplierName?: string; grade?: string; callSign?: string };
      return { name: f.name, roles: f.roles, phone: f.phone, role: f.roles.join(' / '), department: 'Operations', skills: ['Defensive driving', 'Radio procedure'], engagement: extra.engagement, supplierName: extra.supplierName, grade: extra.grade, callSign: extra.callSign };
    }),
  ];
  for (const [i, s] of staffPersonnel.entries()) {
    const person = await prisma.personnel.create({
      data: {
        name: s.name,
        email: s.userId ? staffUsers.find((u) => u.id === s.userId)!.email : `${s.name.toLowerCase().replace(/[^a-z]+/g, '.')}@${DEMO_DOMAIN}`,
        phone: s.phone,
        role: s.role,
        department: s.department,
        status: i === 7 ? 'On Leave' : 'Active',
        location: 'Nairobi',
        manager: s.name === 'Amina Wanjiru' ? undefined : 'Amina Wanjiru',
        joinDate: at(-(120 + i * 45)),
        skills: s.skills,
        roles: s.roles,
        engagement: s.engagement ?? 'Employee',
        supplierName: s.supplierName,
        callSign: s.callSign,
        grade: s.grade,
        userId: s.userId,
        createdById: admin.id,
      },
    });
    personnelByName[s.name] = person.id;
    if (s.roles.includes('Driver')) {
      const f = FIELD_STAFF.find((x) => x.name === s.name)!;
      const driver = await prisma.driver.create({
        data: { name: s.name, personnelId: person.id, phone: s.phone, licenseNumber: f.license, status: s.name === 'Brian Omondi' ? 'Off duty' : 'Available', createdById: admin.id },
      });
      driverIds.push(driver.id);
      await prisma.driverLicense.create({
        data: {
          personnelId: person.id,
          driverName: s.name,
          licenseNumber: f.license!,
          category: f.licenseCategory!,
          expiryDate: at(f.licenseExpiryDays!),
          lastVerified: at(-30),
          notes: f.licenseExpiryDays! < 0 ? 'Expired — renewal booked at NTSA Likoni Road.' : undefined,
          createdById: admin.id,
        },
      });
    }
    if (s.roles.includes('CPO')) {
      const officer = await prisma.officer.create({
        data: { name: s.name, personnelId: person.id, callSign: s.callSign, grade: s.grade ?? 'CPO', phone: s.phone, status: 'Available', createdById: admin.id },
      });
      officerIds.push(officer.id);
    }
  }
  console.log(`personnel: ${staffPersonnel.length}, drivers: ${driverIds.length}, officers: ${officerIds.length}`);

  // ---- vehicles ---------------------------------------------------------
  const vehicleIds: number[] = [];
  for (const v of VEHICLES) {
    const row = await prisma.vehicle.create({ data: { ...v, createdById: admin.id } });
    vehicleIds.push(row.id);
  }

  // ---- customers, contacts, deals, activities ---------------------------
  const customerIds: number[] = [];
  const contactIdsByCustomer: number[][] = [];
  for (const c of CUSTOMERS) {
    const { contacts, ...data } = c;
    const row = await prisma.customer.create({ data: { ...data, createdById: grace.id } });
    customerIds.push(row.id);
    const ids: number[] = [];
    for (const ct of contacts) {
      const contact = await prisma.contact.create({
        data: {
          name: ct.name,
          role: ct.role,
          category: 'Client',
          email: `${ct.name.toLowerCase().replace(/[^a-z]+/g, '.')}@${c.email.split('@')[1]}`,
          phone: c.phone,
          location: c.address,
          tags: ['client', c.entity.toLowerCase()],
          customerId: row.id,
          createdById: grace.id,
        },
      });
      ids.push(contact.id);
    }
    contactIdsByCustomer.push(ids);
  }
  // A few internal / vendor contacts too.
  for (const v of [
    { name: 'Nairobi Hospital Emergency Desk', role: 'Emergency', category: 'Vendor', phone: '+254 20 284 5000', tags: ['medical', 'emergency'] },
    { name: 'Sky Armour Fabricators', role: 'Vehicle armouring', category: 'Vendor', phone: '+254 722 000 111', tags: ['fleet'] },
    { name: 'KQ Protocol Desk, JKIA', role: 'Airport facilitation', category: 'Partner', phone: '+254 20 327 4747', tags: ['airport'] },
  ]) {
    await prisma.contact.create({ data: { ...v, location: 'Nairobi', createdById: amina.id } });
  }

  const deals = [
    { title: 'Executive travel programme Q4', customer: 0, stage: 'execution', value: 48500, days: 25 },
    { title: 'Mine site security review', customer: 1, stage: 'proposal', value: 12800, days: 14 },
    { title: 'Documentary crew — Turkana shoot', customer: 2, stage: 'won', value: 31200, days: 9 },
    { title: 'Board delegation visit (Geneva team)', customer: 3, stage: 'onboarding', value: 22400, days: 40 },
    { title: 'Depot perimeter advisory', customer: 4, stage: 'lead', value: 6000, days: 60 },
    { title: 'Turkana site rotations — annual', customer: 5, stage: 'invoiced', value: 96000, days: -5 },
    { title: 'VIP guest transfers (Karen)', customer: 6, stage: 'closed', value: 4350, days: -20 },
    { title: 'Campus access assessment', customer: 7, stage: 'lost', value: 3800, days: -2, lostReason: 'Went with an in-house hire.' },
    { title: 'Conference security — Nairobi Summit', customer: 0, stage: 'proposal', value: 18900, days: 21 },
    { title: 'Coastal residence protection', customer: 1, stage: 'lead', value: 15600, days: 45 },
  ];
  const dealIds: number[] = [];
  for (const [i, d] of deals.entries()) {
    const row = await prisma.deal.create({
      data: {
        title: d.title,
        customerId: customerIds[d.customer],
        stage: d.stage,
        value: d.value,
        currency: 'USD',
        expectedCloseDate: at(d.days),
        lostReason: d.lostReason,
        signatureStatus: ['won', 'execution', 'invoiced', 'closed'].includes(d.stage) ? 'signed' : d.stage === 'onboarding' ? 'sent' : 'none',
        stageChangedAt: at(-(3 + i * 2)),
        notes: i % 3 === 0 ? 'Client prefers WhatsApp updates during deployments.' : undefined,
        createdById: grace.id,
        createdAt: at(-(10 + i * 5)),
      },
    });
    dealIds.push(row.id);
    const types = ['call', 'email', 'meeting', 'note'] as const;
    for (let k = 0; k < 2; k++) {
      await prisma.crmActivity.create({
        data: {
          customerId: customerIds[d.customer],
          dealId: row.id,
          contactId: contactIdsByCustomer[d.customer][0] ?? null,
          type: types[(i + k) % types.length],
          summary: [
            'Discussed scope and dates; sending revised quote.',
            'Confirmed traveller list and arrival flights.',
            'Site walk-through scheduled with their security manager.',
            'Client asked for an armoured option on day two.',
          ][(i + k) % 4],
          occurredAt: at(-(1 + i + k * 3), 11),
          createdById: k === 0 ? grace.id : amina.id,
        },
      });
    }
  }
  console.log(`customers: ${customerIds.length}, deals: ${dealIds.length}`);

  // ---- products + templates -------------------------------------------
  const productIds: number[] = [];
  for (const p of PRODUCTS) {
    const row = await prisma.product.create({ data: { ...p, currency: 'USD', createdById: daniel.id } });
    productIds.push(row.id);
  }
  await prisma.quoteTemplate.create({
    data: {
      name: 'Executive airport package',
      description: 'Meet & greet plus SUV transfer and one CPO for the first day.',
      taxRate: 0.16,
      currency: 'USD',
      terms: 'Payment within 14 days of invoice. Cancellations under 24h are charged in full.',
      items: [
        { description: 'Airport meet & greet', quantity: 1, days: 1, unitPrice: 90, taxable: true, productId: productIds[3] },
        { description: 'SUV with security driver (per day)', quantity: 1, days: 1, unitPrice: 220, taxable: true, productId: productIds[2] },
        { description: 'Close protection officer (per day)', quantity: 1, days: 1, unitPrice: 350, taxable: true, productId: productIds[0] },
      ],
      createdById: grace.id,
    },
  });
  await prisma.quoteTemplate.create({
    data: {
      name: 'Site deployment (weekly)',
      taxRate: 0.16,
      currency: 'USD',
      items: [
        { description: 'Close protection officer (per day)', quantity: 2, days: 7, unitPrice: 350, taxable: true, productId: productIds[0] },
        { description: 'SUV with security driver (per day)', quantity: 1, days: 7, unitPrice: 220, taxable: true, productId: productIds[2] },
        { description: 'Overnight deployment surcharge', quantity: 2, days: 7, unitPrice: 80, taxable: false, productId: productIds[7] },
      ],
      createdById: grace.id,
    },
  });

  // ---- quotes -----------------------------------------------------------
  const TAX = 0.16;
  const quoteSpecs: Array<{
    customer: number; subject: string; status: string; issue: number; approver?: number; items: LineInput[];
    discount?: { type: 'percentage' | 'fixed'; value: number }; notes?: string;
  }> = [
    { customer: 0, subject: 'Executive travel programme — October', status: 'Sent', issue: -24, approver: admin.id, items: [
      { description: 'Close protection officer (per day)', quantity: 2, days: 10, unitPrice: 350, productId: productIds[0] },
      { description: 'Armoured vehicle with driver (per day)', quantity: 1, days: 10, unitPrice: 650, productId: productIds[1] },
      { description: 'Airport meet & greet', quantity: 4, unitPrice: 90, productId: productIds[3] },
    ] },
    { customer: 2, subject: 'Documentary crew — Turkana shoot (12 days)', status: 'Approved', issue: -9, approver: admin.id, items: [
      { description: 'Close protection officer (per day)', quantity: 3, days: 12, unitPrice: 350, productId: productIds[0] },
      { description: 'SUV with security driver (per day)', quantity: 2, days: 12, unitPrice: 220, productId: productIds[2] },
      { description: 'Route reconnaissance', quantity: 1, unitPrice: 400, productId: productIds[4] },
      { description: 'Overnight deployment surcharge', quantity: 3, days: 11, unitPrice: 80, taxable: false, productId: productIds[7] },
    ], discount: { type: 'percentage', value: 5 } },
    { customer: 1, subject: 'Mine site security review', status: 'Submitted', issue: -2, approver: admin.id, items: [
      { description: 'Security advisory (per hour)', quantity: 40, unitPrice: 120, productId: productIds[5] },
      { description: 'Route reconnaissance', quantity: 2, unitPrice: 400, productId: productIds[4] },
      { description: 'SUV with security driver (per day)', quantity: 1, days: 5, unitPrice: 220, productId: productIds[2] },
    ], notes: 'Includes a written report within 5 working days of the visit.' },
    { customer: 3, subject: 'Board delegation visit — 4 principals, 3 days', status: 'Draft', issue: 0, items: [
      { description: 'Close protection officer (per day)', quantity: 4, days: 3, unitPrice: 350, productId: productIds[0] },
      { description: 'Armoured vehicle with driver (per day)', quantity: 2, days: 3, unitPrice: 650, productId: productIds[1] },
      { description: 'Airport meet & greet', quantity: 4, unitPrice: 90, productId: productIds[3] },
    ] },
    { customer: 0, subject: 'Conference security — Nairobi Summit', status: 'Submitted', issue: -1, approver: admin.id, items: [
      { description: 'Close protection officer (per day)', quantity: 6, days: 2, unitPrice: 350, productId: productIds[0] },
      { description: 'Secure transfer (per trip)', quantity: 12, unitPrice: 150, productId: productIds[6] },
    ] },
    { customer: 6, subject: 'VIP guest transfers — Karen', status: 'Sent', issue: -31, approver: admin.id, items: [
      { description: 'Secure transfer (per trip)', quantity: 18, unitPrice: 150, productId: productIds[6] },
      { description: 'Airport meet & greet', quantity: 6, unitPrice: 90, productId: productIds[3] },
    ] },
    { customer: 7, subject: 'Campus access assessment', status: 'Declined', issue: -15, approver: admin.id, items: [
      { description: 'Security advisory (per hour)', quantity: 24, unitPrice: 120, productId: productIds[5] },
    ], notes: 'Declined: scope too small for a two-person team; offer advisory-only.' },
    { customer: 4, subject: 'Depot perimeter advisory', status: 'Expired', issue: -75, approver: admin.id, items: [
      { description: 'Security advisory (per hour)', quantity: 16, unitPrice: 120, productId: productIds[5] },
      { description: 'Route reconnaissance', quantity: 1, unitPrice: 400, productId: productIds[4] },
    ] },
  ];
  const quoteIds: number[] = [];
  for (const [i, q] of quoteSpecs.entries()) {
    const t = totals(q.items, TAX, q.discount ?? { type: 'none', value: 0 });
    const issueDate = at(q.issue);
    const submitted = ['Submitted', 'Approved', 'Declined', 'Sent', 'Expired'].includes(q.status);
    const decided = ['Approved', 'Declined', 'Sent', 'Expired'].includes(q.status);
    const row = await prisma.quote.create({
      data: {
        reference: `QT-${year}-${pad4(i + 1)}`,
        customerId: customerIds[q.customer],
        createdById: grace.id,
        approverId: q.approver ?? null,
        brandProfileId: brand.id,
        subject: q.subject,
        status: q.status,
        issueDate,
        expiryDate: new Date(issueDate.getTime() + 30 * DAY),
        currency: 'USD',
        taxRate: TAX,
        discountType: q.discount?.type ?? 'none',
        discountValue: q.discount?.value ?? 0,
        discountAmount: t.discountAmount,
        subtotal: t.subtotal,
        tax: t.tax,
        total: t.total,
        notes: q.notes,
        terms: 'Payment within 14 days of invoice. Rates exclude flights and accommodation unless itemised.',
        submittedAt: submitted ? new Date(issueDate.getTime() + 2 * 60 * 60 * 1000) : null,
        decidedAt: decided ? new Date(issueDate.getTime() + DAY) : null,
        decisionNote: q.status === 'Declined' ? 'Not viable at this size.' : null,
        sentAt: q.status === 'Sent' ? new Date(issueDate.getTime() + 2 * DAY) : null,
        createdAt: issueDate,
        items: {
          create: t.lines.map((l) => ({
            position: l.position,
            description: l.description,
            quantity: l.quantity,
            days: l.days,
            unitPrice: l.unitPrice,
            taxable: l.taxable,
            total: l.total,
            productId: l.productId ?? null,
          })),
        },
      },
    });
    quoteIds.push(row.id);
    if (q.status === 'Submitted') {
      await prisma.quoteNotification.create({
        data: { userId: admin.id, quoteId: row.id, type: 'submitted', message: `${grace.name} submitted quote ${row.reference} for your approval`, createdAt: row.submittedAt! },
      });
    }
  }
  await prisma.quoteSequence.upsert({ where: { year }, update: { lastNumber: quoteSpecs.length }, create: { year, lastNumber: quoteSpecs.length } });
  // Link the pipeline to its paperwork.
  await prisma.deal.update({ where: { id: dealIds[0] }, data: { quoteId: quoteIds[0] } });
  await prisma.deal.update({ where: { id: dealIds[2] }, data: { quoteId: quoteIds[1] } });
  await prisma.deal.update({ where: { id: dealIds[1] }, data: { quoteId: quoteIds[2] } });
  await prisma.deal.update({ where: { id: dealIds[8] }, data: { quoteId: quoteIds[4] } });
  console.log(`quotes: ${quoteIds.length}`);

  // ---- invoices + payments --------------------------------------------
  const invoiceSpecs: Array<{ customer: number; quote?: number; status: string; issue: number; items: LineInput[]; paid?: number[] }> = [
    { customer: 6, quote: 5, status: 'Paid', issue: -28, items: [
      { description: 'Secure transfer (per trip)', quantity: 18, unitPrice: 150, productId: productIds[6] },
      { description: 'Airport meet & greet', quantity: 6, unitPrice: 90, productId: productIds[3] },
    ], paid: [1] },
    { customer: 5, status: 'Partial', issue: -20, items: [
      { description: 'Close protection officer (per day)', quantity: 4, unitPrice: 350 * 30, productId: productIds[0] },
      { description: 'SUV with security driver (per day)', quantity: 2, unitPrice: 220 * 30, productId: productIds[2] },
    ], paid: [0.5] },
    { customer: 0, quote: 0, status: 'Sent', issue: -6, items: [
      { description: 'Close protection officer (per day)', quantity: 20, unitPrice: 350, productId: productIds[0] },
      { description: 'Armoured vehicle with driver (per day)', quantity: 10, unitPrice: 650, productId: productIds[1] },
      { description: 'Airport meet & greet', quantity: 4, unitPrice: 90, productId: productIds[3] },
    ] },
    { customer: 2, quote: 1, status: 'Pending Approval', issue: -1, items: [
      { description: 'Route reconnaissance (advance)', quantity: 1, unitPrice: 400, productId: productIds[4] },
      { description: 'SUV with security driver — recce days', quantity: 2, unitPrice: 220, productId: productIds[2] },
    ] },
    { customer: 1, status: 'Draft', issue: 0, items: [
      { description: 'Security advisory (per hour)', quantity: 8, unitPrice: 120, productId: productIds[5] },
    ] },
    { customer: 4, status: 'Void', issue: -50, items: [
      { description: 'Security advisory (per hour)', quantity: 4, unitPrice: 120, productId: productIds[5] },
    ] },
  ];
  const invoiceIds: number[] = [];
  for (const [i, inv] of invoiceSpecs.entries()) {
    const t = totals(inv.items, TAX);
    const issueDate = at(inv.issue);
    const amountPaid = round2((inv.paid ?? []).reduce((acc, f) => acc + t.total * f, 0));
    const row = await prisma.invoice.create({
      data: {
        number: `INV-${year}-${pad4(i + 1)}`,
        customerId: customerIds[inv.customer],
        createdById: daniel.id,
        approverId: inv.status === 'Draft' ? null : admin.id,
        brandProfileId: brand.id,
        sourceQuoteId: inv.quote !== undefined ? quoteIds[inv.quote] : null,
        status: inv.status,
        issueDate,
        dueDate: new Date(issueDate.getTime() + 14 * DAY),
        currency: 'USD',
        taxRate: TAX,
        subtotal: t.subtotal,
        tax: t.tax,
        total: t.total,
        amountPaid,
        terms: 'Payment within 14 days. Bank: Demo Bank Kenya, USD account 0011223344.',
        submittedAt: inv.status === 'Draft' ? null : issueDate,
        decidedAt: ['Draft', 'Pending Approval'].includes(inv.status) ? null : new Date(issueDate.getTime() + 3 * 60 * 60 * 1000),
        sentAt: ['Sent', 'Partial', 'Paid'].includes(inv.status) ? new Date(issueDate.getTime() + DAY) : null,
        paidAt: inv.status === 'Paid' ? new Date(issueDate.getTime() + 9 * DAY) : null,
        createdAt: issueDate,
        items: {
          create: t.lines.map((l) => ({ position: l.position, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, taxable: l.taxable, total: l.total, productId: l.productId ?? null })),
        },
      },
    });
    invoiceIds.push(row.id);
    for (const [k, fraction] of (inv.paid ?? []).entries()) {
      await prisma.invoicePayment.create({
        data: { invoiceId: row.id, amount: round2(t.total * fraction), method: k === 0 ? 'Bank transfer' : 'M-Pesa', reference: `TRX${year}${pad4(i * 10 + k + 1)}`, paidAt: new Date(issueDate.getTime() + (9 - k * 3) * DAY), createdById: daniel.id },
      });
    }
    if (inv.status === 'Pending Approval') {
      await prisma.invoiceNotification.create({ data: { userId: admin.id, invoiceId: row.id, type: 'submitted', message: `${daniel.name} submitted invoice ${row.number} for your approval`, createdAt: issueDate } });
    }
  }
  await prisma.invoiceSequence.upsert({ where: { year }, update: { lastNumber: invoiceSpecs.length }, create: { year, lastNumber: invoiceSpecs.length } });
  console.log(`invoices: ${invoiceIds.length}`);

  // ---- travellers + trips ---------------------------------------------
  const travelerSpecs = [
    { name: 'Tom Barrett', customer: 0, nationality: 'British', riskLevel: 'Elevated', dietaryNotes: 'No shellfish', emergencyContactName: 'Anna Barrett', emergencyContactPhone: '+44 7700 900123' },
    { name: 'Sophie Laurent', customer: 0, nationality: 'French', riskLevel: 'Standard' },
    { name: 'Kevin Oduya', customer: 2, nationality: 'Kenyan', riskLevel: 'Standard' },
    { name: 'Maya Patel', customer: 2, nationality: 'Indian', riskLevel: 'Standard', medicalNotes: 'Carries an EpiPen (peanut allergy).' },
    { name: 'Dr. Lena Fischer', customer: 3, nationality: 'Swiss', riskLevel: 'High', notes: 'Public profile; avoid published itineraries.' },
    { name: 'Rose Akinyi', customer: 1, nationality: 'Kenyan', riskLevel: 'Standard' },
  ];
  const travelerIds: number[] = [];
  for (const [i, spec] of travelerSpecs.entries()) {
    const { customer, ...t } = spec;
    const row = await prisma.traveler.create({
      data: { ...t, customerId: customerIds[customer], email: `${t.name.toLowerCase().replace(/[^a-z]+/g, '.')}@traveller.test`, phone: `+254 7${String(10 + i)}0 ${String(100 + i * 37).padStart(3, '0')} ${String(400 + i * 11)}`, passportNumber: `P${String(4000000 + i * 12345)}`, passportExpiry: at(400 + i * 90), dateOfBirth: new Date(1975 + i * 3, i, 10 + i), status: 'Active', createdById: amina.id },
    });
    travelerIds.push(row.id);
  }

  const tripSpecs = [
    { title: 'Kilimani Capital — Nairobi executive week', customer: 0, quote: 0, status: 'Active', start: -2, days: 5, owner: amina.id, travelers: [0, 1], vehicle: 0, driver: 0, officer: 0 },
    { title: 'Savannah Broadcasting — Turkana documentary', customer: 2, quote: 1, status: 'Planned', start: 6, days: 12, owner: amina.id, travelers: [2, 3], vehicle: 1, driver: 2, officer: 1 },
    { title: 'Aurora Health — board delegation', customer: 3, status: 'Draft', start: 40, days: 3, owner: grace.id, travelers: [4], vehicle: 2, driver: 1, officer: 2 },
    { title: 'Meridian Mining — Mombasa site visit', customer: 1, status: 'Completed', start: -30, days: 2, owner: amina.id, travelers: [5], vehicle: 3, driver: 0, officer: 3 },
  ];
  let trackingSeq = 0;
  for (const [i, tr] of tripSpecs.entries()) {
    const start = at(tr.start, 8);
    const end = at(tr.start + tr.days - 1, 18);
    const trackingCode = `LA-${year}-${pad4(++trackingSeq)}`;
    const trip = await prisma.trip.create({
      data: {
        reference: `TR-${year}-${pad4(i + 1)}`,
        trackingCode,
        customerId: customerIds[tr.customer],
        sourceQuoteId: tr.quote !== undefined ? quoteIds[tr.quote] : null,
        createdById: amina.id,
        ownerId: tr.owner,
        title: tr.title,
        description: 'Secure ground movement, airport facilitation and close protection for the visiting team.',
        status: tr.status,
        startDate: start,
        endDate: end,
        currency: 'USD',
        notes: 'Control room on channel Ops-1. Daily SITREP to the client at 18:00.',
      },
    });
    if (tr.quote !== undefined) {
      await prisma.quote.update({ where: { id: quoteIds[tr.quote] }, data: { trackingCode } });
    }
    for (const [k, travelerIndex] of tr.travelers.entries()) {
      await prisma.tripTraveler.create({ data: { tripId: trip.id, travelerId: travelerIds[travelerIndex], isPrimary: k === 0 } });
    }
    await prisma.tripAssignment.create({
      data: { tripId: trip.id, vehicleId: vehicleIds[tr.vehicle], driverId: driverIds[tr.driver], officerId: officerIds[tr.officer], status: tr.status === 'Completed' ? 'Completed' : tr.status === 'Active' ? 'Active' : tr.status === 'Planned' ? 'Confirmed' : 'Planned', notes: 'Primary vehicle and detail.', createdById: amina.id },
    });
    if (tr.status === 'Planned') {
      await prisma.tripAssignment.create({ data: { tripId: trip.id, vehicleId: vehicleIds[5], driverId: driverIds[1], officerId: officerIds[2], status: 'Planned', notes: 'Second vehicle for crew and kit.', createdById: amina.id } });
    }
    // Days + itinerary
    let position = 0;
    const dayIds: number[] = [];
    for (let dnum = 1; dnum <= Math.min(tr.days, 4); dnum++) {
      const dayDate = at(tr.start + dnum - 1);
      const day = await prisma.tripDay.create({ data: { tripId: trip.id, dateKey: dateKey(dayDate), dayNumber: dnum, title: dnum === 1 ? 'Arrival' : dnum === tr.days ? 'Departure' : `Day ${dnum}`, summary: dnum === 1 ? 'Meet at arrivals, secure transfer to the hotel, evening brief.' : undefined } });
      dayIds.push(day.id);
    }
    const items: Array<Parameters<typeof prisma.tripItineraryItem.create>[0]['data']> = [
      { tripId: trip.id, dayId: dayIds[0], position: position++, itemType: 'flight', category: 'flight', description: 'Arrival flight', subtitle: 'KQ 101 from London Heathrow', timeLabel: '06:45', providerName: 'Kenya Airways', placeName: 'JKIA Terminal 1A', quantity: tr.travelers.length, scheduledAt: at(tr.start, 6, 45), durationMinutes: 60, details: { flightNumber: 'KQ101', cabin: 'Business', departAirport: 'LHR', arriveAirport: 'NBO', terminal: '1A', baggage: '2 × 23 kg' }, confirmationCode: `KQ${String(100000 + i * 777)}` },
      { tripId: trip.id, dayId: dayIds[0], position: position++, itemType: 'car', category: 'transportation', description: 'Secure transfer to hotel', timeLabel: '08:00', providerName: 'Lady Askari', placeName: 'Villa Rosa Kempinski', quantity: 1, unitPrice: 150, scheduledAt: at(tr.start, 8), durationMinutes: 50, details: { mode: 'Armoured SUV', vehicle: VEHICLES[tr.vehicle].registration, pickupLocation: 'JKIA T1A arrivals', dropoffLocation: 'Villa Rosa Kempinski', driverName: FIELD_STAFF[tr.driver === 2 ? 2 : tr.driver].name } },
      { tripId: trip.id, dayId: dayIds[0], position: position++, itemType: 'hotel', category: 'lodging', description: 'Hotel check-in', subtitle: 'Executive suites, 3 nights', timeLabel: '09:30', providerName: 'Villa Rosa Kempinski', placeName: 'Villa Rosa Kempinski, Westlands', address: 'Chiromo Road, Nairobi', quantity: tr.travelers.length, scheduledAt: at(tr.start, 9, 30), details: { roomType: 'Executive suite', nights: String(Math.max(tr.days - 1, 1)), guests: String(tr.travelers.length), checkInTime: '14:00', checkOutTime: '11:00', boardBasis: 'Bed & breakfast' }, confirmationCode: `VRK-${7000 + i}` },
      { tripId: trip.id, dayId: dayIds[Math.min(1, dayIds.length - 1)], position: position++, itemType: 'activity', category: 'activity', description: 'Client meetings — Upper Hill', body: 'Two meetings; CPO remains with principal. Vehicle staged at the Britam Tower basement.', timeLabel: '10:00–15:00', placeName: 'Britam Tower', quantity: 1, scheduledAt: at(tr.start + 1, 10), endsAt: at(tr.start + 1, 15), durationMinutes: 300, reminderMinutesBefore: 60, details: { durationText: '5 hours', whatToBring: 'Visitor IDs for the building' } },
      { tripId: trip.id, dayId: dayIds[Math.min(1, dayIds.length - 1)], position: position++, itemType: 'location', category: 'booking', description: 'Dinner reservation', timeLabel: '19:30', providerName: 'Talisman', placeName: 'Talisman Restaurant, Karen', quantity: tr.travelers.length, scheduledAt: at(tr.start + 1, 19, 30), details: { bookingRef: `TAL-${300 + i}`, partySize: String(tr.travelers.length + 1), dressCode: 'Smart casual' } },
    ];
    for (const data of items) await prisma.tripItineraryItem.create({ data });
  }
  await prisma.tripSequence.upsert({ where: { year }, update: { lastNumber: tripSpecs.length }, create: { year, lastNumber: tripSpecs.length } });
  await prisma.trackingSequence.upsert({ where: { year }, update: { lastNumber: trackingSeq }, create: { year, lastNumber: trackingSeq } });
  console.log(`travellers: ${travelerIds.length}, trips: ${tripSpecs.length}`);

  // ---- contracts --------------------------------------------------------
  const contracts = [
    { reference: `CTR-${year}-001`, counterpartyName: 'Northstar Energy Kenya Ltd', type: 'Retainer', status: 'Active', start: -300, end: 65, value: 96000, department: 'Operations' },
    { reference: `CTR-${year}-002`, counterpartyName: 'Kilimani Capital Partners LLP', type: 'Fixed Term', status: 'Active', start: -200, end: 12, value: 48500, department: 'Sales' },
    { reference: `CTR-${year}-003`, counterpartyName: 'Sky Armour Fabricators', type: 'Project Based', status: 'Active', start: -45, end: 120, value: 22000, department: 'Fleet', notes: 'Armour refit for KDE 654E.' },
    { reference: `CTR-${year - 1}-014`, counterpartyName: 'Crescent Hospitality Group', type: 'Retainer', status: 'Renewed', start: -400, end: 330, value: 18000, lastRenewal: -35 },
    { reference: `CTR-${year - 1}-009`, counterpartyName: 'Westlands Tech Hub Ltd', type: 'Fixed Term', status: 'Expired', start: -500, end: -40, value: 9000 },
    { reference: `CTR-${year}-004`, counterpartyName: 'Coastline Risk Advisory', type: 'Project Based', status: 'Active', start: -10, end: 80, value: 7500, department: 'Security' },
  ];
  for (const c of contracts) {
    await prisma.contract.create({
      data: { reference: c.reference, counterpartyName: c.counterpartyName, email: `legal@${c.counterpartyName.toLowerCase().split(' ')[0]}.test`, department: c.department, type: c.type, status: c.status, startDate: at(c.start), endDate: at(c.end), value: c.value, currency: 'USD', lastRenewalDate: c.lastRenewal !== undefined ? at(c.lastRenewal) : null, notes: c.notes, createdById: faith.id },
    });
  }

  // ---- calendar ---------------------------------------------------------
  const events = [
    { user: admin.id, title: 'Ops stand-up', tag: 'Operations', day: 0, hour: 8, minutes: 30, location: 'Control room' },
    { user: admin.id, title: 'Kilimani Capital — principal movement', tag: 'Client', day: 0, hour: 10, minutes: 300, location: 'Upper Hill' },
    { user: admin.id, title: 'Quote review: Nairobi Summit', tag: 'Sales', day: 1, hour: 14, minutes: 45 },
    { user: admin.id, title: 'Fleet inspection — KDE 654E back from workshop', tag: 'Fleet', day: 2, hour: 9, minutes: 60, location: 'Sky Armour, Mombasa Road' },
    { user: admin.id, title: 'Turkana deployment briefing', tag: 'Operations', day: 5, hour: 15, minutes: 90, location: 'Boardroom', reminder: 60 },
    { user: admin.id, title: 'Contract renewal — Kilimani Capital', tag: 'Admin', day: 10, hour: 11, minutes: 60, reminder: 1440 },
    { user: admin.id, title: 'NTSA licence renewal — Samuel Kiprotich', tag: 'Compliance', day: 20, allDay: true },
    { user: admin.id, title: 'Monthly close', tag: 'Finance', day: 3, hour: 16, minutes: 120 },
    { user: amina.id, title: 'Advance recce — Lodwar airstrip', tag: 'Operations', day: 3, hour: 7, minutes: 480, location: 'Lodwar' },
    { user: grace.id, title: 'Aurora Health call', tag: 'Client', day: 1, hour: 11, minutes: 30 },
    { user: daniel.id, title: 'Chase INV-0002 balance (Northstar)', tag: 'Finance', day: 2, hour: 10, minutes: 15 },
    { user: admin.id, title: 'Team braai', tag: 'Social', day: 12, hour: 17, minutes: 180, location: 'Karura Forest' },
  ];
  for (const e of events) {
    const startsAt = e.allDay ? at(e.day, 0) : at(e.day, e.hour!);
    await prisma.calendarEvent.create({
      data: { userId: e.user, title: e.title, tag: e.tag, location: e.location, startsAt, endsAt: e.allDay ? null : new Date(startsAt.getTime() + (e.minutes ?? 60) * 60000), allDay: Boolean(e.allDay), reminderMinutesBefore: e.reminder ?? null, reminderAt: e.reminder ? new Date(startsAt.getTime() - e.reminder * 60000) : null },
    });
  }
  const holidays = [[`${year}-01-01`, "New Year's Day"], [`${year}-05-01`, 'Labour Day'], [`${year}-06-01`, 'Madaraka Day'], [`${year}-10-10`, 'Utamaduni Day'], [`${year}-10-20`, 'Mashujaa Day'], [`${year}-12-12`, 'Jamhuri Day'], [`${year}-12-25`, 'Christmas Day'], [`${year}-12-26`, 'Boxing Day']];
  for (const [date, name] of holidays) await prisma.publicHoliday.create({ data: { date, name, createdById: faith.id } });

  // ---- teams, shift templates, schedule, leave --------------------------
  const teams = [
    { name: 'Alpha Detail', colour: 'emerald', members: [peter.id, amina.id] },
    { name: 'Bravo Detail', colour: 'violet', members: [grace.id, daniel.id] },
    { name: 'Control Room', colour: 'amber', members: [faith.id, amina.id] },
  ];
  const teamIds: string[] = [];
  for (const t of teams) {
    const row = await prisma.team.create({ data: { name: t.name, colour: t.colour, createdById: admin.id, members: { create: t.members.map((userId) => ({ userId })) } } });
    teamIds.push(row.id);
  }
  const templates = [
    { name: 'Day detail', startTime: '06:00', endTime: '18:00', weekdays: [1, 2, 3, 4, 5], colour: 'blue', sortOrder: 0, teams: [teamIds[0]] },
    { name: 'Night detail', startTime: '18:00', endTime: '06:00', weekdays: [1, 2, 3, 4, 5, 6, 0], colour: 'violet', sortOrder: 1, teams: [teamIds[1]] },
    { name: 'Control room', startTime: '08:00', endTime: '17:00', weekdays: [1, 2, 3, 4, 5], colour: 'amber', sortOrder: 2, teams: [teamIds[2]] },
  ];
  for (const t of templates) {
    await prisma.shiftTemplate.create({ data: { name: t.name, startTime: t.startTime, endTime: t.endTime, weekdays: t.weekdays, colour: t.colour, sortOrder: t.sortOrder, createdById: admin.id, teams: { create: t.teams.map((teamId) => ({ teamId })) } } });
  }
  const scheduleRows: Array<{ employeeId: number; date: string; type: string; startTime?: string; endTime?: string; timeLabel?: string; role?: string; location?: string }> = [];
  for (let d = -7; d <= 14; d++) {
    const date = at(d);
    const key = dateKey(date);
    const weekday = date.getDay();
    if (weekday >= 1 && weekday <= 5) {
      scheduleRows.push({ employeeId: amina.id, date: key, type: 'work-day', startTime: '08:00', endTime: '17:00', timeLabel: '08:00–17:00', role: 'Ops manager', location: 'HQ' });
      scheduleRows.push({ employeeId: daniel.id, date: key, type: 'work-day', startTime: '08:30', endTime: '17:30', timeLabel: '08:30–17:30', role: 'Finance', location: 'HQ' });
      scheduleRows.push({ employeeId: grace.id, date: key, type: 'work-day', startTime: '09:00', endTime: '18:00', timeLabel: '09:00–18:00', role: 'Sales', location: 'HQ / client sites' });
      scheduleRows.push({ employeeId: faith.id, date: key, type: d >= 8 && d <= 12 ? 'vacation' : 'work-day', startTime: '08:00', endTime: '17:00', timeLabel: '08:00–17:00', role: 'Control room', location: 'HQ' });
    }
    scheduleRows.push({ employeeId: peter.id, date: key, type: weekday === 0 || weekday === 6 ? 'available' : 'work-night', startTime: '18:00', endTime: '06:00', timeLabel: '18:00–06:00', role: 'Night detail lead', location: 'Client residence, Karen' });
  }
  for (const row of scheduleRows) {
    await prisma.scheduleShift.create({ data: { ...row, publishedAt: at(-8), createdById: admin.id } });
  }
  await prisma.leaveRequest.create({ data: { userId: faith.id, type: 'annual', startDate: dateKey(at(8)), endDate: dateKey(at(12)), status: 'approved', note: 'Family trip to Kisumu.', decidedById: admin.id, decidedAt: at(-3) } });
  await prisma.leaveRequest.create({ data: { userId: grace.id, type: 'casual', startDate: dateKey(at(4)), endDate: dateKey(at(4)), status: 'pending', note: 'Half-day for a school event.' } });
  await prisma.leaveRequest.create({ data: { userId: daniel.id, type: 'sick', startDate: dateKey(at(-6)), endDate: dateKey(at(-5)), status: 'approved', decidedById: amina.id, decidedAt: at(-6) } });
  console.log(`schedule shifts: ${scheduleRows.length}`);

  // ---- personal tasks ---------------------------------------------------
  const todos = [
    { title: 'Finalise Turkana deployment plan', priority: 'high', status: 'In progress', due: 4, subtasks: ['Confirm charter flight', 'Issue sat phones', 'Brief medical evacuation plan'], done: [true, true, false] },
    { title: 'Approve pending quotes', priority: 'high', status: 'Backlog', due: 1, subtasks: ['Mine site security review', 'Nairobi Summit'], done: [false, false] },
    { title: 'Review licence expiries', priority: 'medium', status: 'Backlog', due: 7, subtasks: ['Samuel Kiprotich (23 days)', 'Brian Omondi (expired)'], done: [false, false] },
    { title: 'Sign off SOP-004 radio procedure v1.2', priority: 'medium', status: 'In review', due: 3 },
    { title: 'Collect KDE 654E from workshop', priority: 'low', status: 'Backlog', due: 2 },
    { title: 'Chase Northstar for INV balance', priority: 'medium', status: 'In progress', due: 2, shared: [daniel.id] },
    { title: 'Prepare board delegation proposal', priority: 'high', status: 'Backlog', due: 9, shared: [grace.id] },
    { title: 'Order replacement body armour plates', priority: 'low', status: 'Backlog', due: 21 },
    { title: 'Quarterly fleet insurance renewal', priority: 'medium', status: 'In review', due: 14 },
    { title: 'Archive completed Mombasa trip file', priority: 'low', status: 'In review', due: -1, completed: true },
  ];
  await prisma.personalTodoBoard.create({ data: { userId: admin.id, columns: ['Backlog', 'In progress', 'In review'], columnColors: { Backlog: '#E5E7EB', 'In progress': '#DBEAFE', 'In review': '#FEF3C7' } } });
  const todoIds: number[] = [];
  for (const [i, t] of todos.entries()) {
    const row = await prisma.personalTodo.create({
      data: {
        userId: admin.id,
        title: t.title,
        description: i % 2 === 0 ? 'Added from the ops stand-up.' : undefined,
        priority: t.priority,
        status: t.status,
        startDate: at(-2),
        dueDate: at(t.due, 17),
        completed: Boolean(t.completed),
        completedAt: t.completed ? at(-1, 16) : null,
        subtasks: t.subtasks ? t.subtasks.map((title, k) => ({ id: `st-${i}-${k}`, title, completed: Boolean(t.done?.[k]) })) : undefined,
        createdAt: at(-(5 + i)),
      },
    });
    todoIds.push(row.id);
    for (const userId of t.shared ?? []) {
      await prisma.personalTodoShare.create({ data: { todoId: row.id, userId } });
      await prisma.personalTodoComment.create({ data: { todoId: row.id, userId, body: 'On it — will update by end of day.', createdAt: at(-1, 12) } });
      await prisma.personalTodoNotification.create({ data: { userId: admin.id, todoId: row.id, type: 'comment', message: `${staffUsers.find((u) => u.id === userId)!.name} commented on "${t.title}"`, createdAt: at(-1, 12) } });
    }
  }
  await prisma.personalTodoBoard.update({ where: { userId: admin.id }, data: { taskOrder: todoIds.map(String) } });

  // ---- notes, feedback, SOPs, handovers, intel ---------------------------
  for (const n of [
    { title: 'Control room numbers', content: 'Ops-1 channel: Zello "LA Ops". Duty phone: +254 700 000 001. Police OCS Kilimani: +254 20 272 0000.', category: 'Work', color: 'blue', pinned: true },
    { title: 'Turkana packing list', content: '- Sat phone + spare battery\n- 20 L water per vehicle\n- Trauma kit (checked)\n- Letters of introduction for county admin', category: 'Work', color: 'yellow' },
    { title: 'Idea: client portal', content: 'Share live tracking link + daily SITREP in one page per trip.', category: 'Ideas', color: 'purple' },
    { title: 'Gym', content: 'Tue/Thu 06:00', category: 'Personal', color: 'green' },
    { title: 'Supplier to try', content: 'Sky Armour quoted 20% under last year for run-flat sets.', category: 'Work', color: 'pink' },
  ]) {
    await prisma.note.create({ data: { ...n, userId: admin.id } });
  }

  const feedbackSpecs = [
    { title: 'Add trip tracking link to client emails', category: 'Feature Idea', status: 'Planned', author: grace.id, upvotes: [amina.id, daniel.id] },
    { title: 'Map loses my layer selection after refresh', category: 'Bug Report', status: 'Under Review', author: peter.id, upvotes: [amina.id] },
    { title: 'Invoice PDF should show the VAT number', category: 'Improvement', status: 'Implemented', author: daniel.id, upvotes: [] },
    { title: 'Shift planner: bulk-assign a team to a week', category: 'Feature Idea', status: 'New', author: faith.id, upvotes: [amina.id, peter.id, grace.id] },
    { title: 'Cannot upload HEIC photos from iPhone', category: 'Technical Support', status: 'Declined', author: amina.id, upvotes: [] },
  ];
  for (const f of feedbackSpecs) {
    const row = await prisma.feedback.create({ data: { title: f.title, description: 'Raised during the weekly review. Details in the thread.', category: f.category, status: f.status, authorId: f.author, createdAt: at(-14) } });
    for (const userId of f.upvotes) await prisma.feedbackUpvote.create({ data: { feedbackId: row.id, userId } });
    if (f.upvotes.length) await prisma.feedbackComment.create({ data: { feedbackId: row.id, userId: admin.id, body: 'Thanks — scheduled for the next sprint.', createdAt: at(-10) } });
  }

  const sops = [
    { code: 'SOP-001', title: 'Airport arrival facilitation', category: 'Operations', status: 'Active', version: 'v2.1', ownerName: 'Amina Wanjiru', steps: ['Confirm flight status 2h before ETA', 'Greeter at arrivals with name board 30 min before landing', 'Vehicle staged at Terminal 1A pick-up bay', 'Radio check with control room', 'Depart via Mombasa Road; avoid Airport North Road after 18:00'] },
    { code: 'SOP-002', title: 'Vehicle pre-deployment inspection', category: 'Safety', status: 'Active', version: 'v1.4', ownerName: 'Joseph Mutua', steps: ['Tyres and run-flats', 'Fuel above ¾', 'Tracker online', 'Trauma kit sealed', 'Comms test'] },
    { code: 'SOP-003', title: 'Incident reporting', category: 'Operations', status: 'Review', version: 'v1.0', ownerName: 'Peter Kamau', steps: ['Secure the principal', 'Call control room on Ops-1', 'Record time, location, persons involved', 'Submit written report within 12 hours'] },
    { code: 'SOP-004', title: 'Radio procedure', category: 'Operations', status: 'Draft', version: 'v1.2', ownerName: 'Hassan Abdi', steps: ['Call signs only', 'No client names on air', 'Hourly check-ins'] },
    { code: 'SOP-005', title: 'Leave and overtime approvals', category: 'Human Resources', status: 'Active', version: 'v1.0', ownerName: 'Faith Njeri', steps: ['Submit in the shift planner', 'Manager decides within 48h', 'HR records on the roster'] },
  ];
  for (const [i, s] of sops.entries()) {
    const row = await prisma.sop.create({ data: { ...s, description: 'Standard operating procedure.', effectiveDate: at(-(60 + i * 20)), reviewDate: at(i === 2 ? -3 : 150 + i * 30), createdById: admin.id } });
    await prisma.sopRevision.create({ data: { sopId: row.id, version: s.version, summary: 'Initial import of the current procedure.', changedById: admin.id, createdAt: at(-(60 + i * 20)) } });
    if (s.status === 'Active') {
      for (const u of [amina, peter]) await prisma.sopAcknowledgement.create({ data: { sopId: row.id, userId: u.id, version: s.version, acknowledgedAt: at(-(30 + i * 5)) } });
    }
  }

  const handovers = [
    { day: 0, period: 'Day', post: 'Kilimani Capital detail', status: 'Normal', summary: 'Principal moved Kempinski → Upper Hill → Kempinski without incident. Vehicle KDA 123A refuelled.', by: peter.id },
    { day: -1, period: 'Night', post: 'Client residence, Karen', status: 'Attention', summary: 'Quiet night. Motion sensor on the east fence triggered twice (monkeys); logged with the estate guards.', watchItems: 'East fence sensor sensitivity to be adjusted.', by: peter.id, ack: amina.id },
    { day: -1, period: 'Day', post: 'Control room', status: 'Normal', summary: 'All details checked in hourly. Tracker on KDE 654E offline (vehicle in workshop).', by: faith.id, ack: amina.id },
    { day: -2, period: 'Night', post: 'Client residence, Karen', status: 'Urgent', summary: 'Suspicious vehicle parked opposite the gate 23:10–23:40; plate KCK 220P reported to Karen police. No approach made.', incidents: 'Unknown vehicle loitering outside the residence.', watchItems: 'Police feedback on plate KCK 220P.', by: peter.id, ack: admin.id },
    { day: -2, period: 'Day', post: 'Mombasa site visit', status: 'Normal', summary: 'Site visit completed; return to Nairobi by road, arrived 19:40.', by: amina.id, ack: admin.id },
    { day: -3, period: 'Day', post: 'Control room', status: 'Normal', summary: 'Routine. Fuel cards reconciled.', by: faith.id, ack: amina.id },
  ];
  for (const h of handovers) {
    await prisma.handoverEntry.create({ data: { shiftDate: at(h.day), shiftPeriod: h.period, post: h.post, status: h.status, summary: h.summary, incidents: h.incidents, watchItems: h.watchItems, createdById: h.by, acknowledgedById: h.ack ?? null, acknowledgedAt: h.ack ? at(h.day, 19) : null } });
  }

  for (const a of [
    { location: 'Nairobi CBD', formattedAddress: 'Central Business District, Nairobi, Kenya', country: 'Kenya', latitude: -1.2864, longitude: 36.8172, riskLevel: 'Moderate', title: 'Nairobi CBD — daytime movement assessment', summary: 'Petty crime and traffic congestion are the main risks for vehicle moves through the CBD; demonstrations near Parliament are periodic and well-signposted.', sections: [{ heading: 'Crime', body: 'Phone snatching and bag theft at junctions; keep windows up and doors locked.' }, { heading: 'Traffic', body: 'Expect 40–60 minute transits 07:00–10:00 and 16:00–20:00. Use Haile Selassie Avenue as the alternate.' }, { heading: 'Civil unrest', body: 'Protests cluster around Parliament Road and Harambee Avenue; monitor on protest days.' }], recommendations: ['Plan CBD moves outside peak hours', 'Two-vehicle moves for high-profile principals', 'Pre-position at Kenyatta Avenue for rapid exit'], sources: [{ title: 'UK FCDO travel advice — Kenya', url: 'https://www.gov.uk/foreign-travel-advice/kenya' }] },
    { location: 'Lodwar, Turkana', formattedAddress: 'Lodwar, Turkana County, Kenya', country: 'Kenya', latitude: 3.1191, longitude: 35.5973, riskLevel: 'High', title: 'Turkana field deployment — route and site assessment', summary: 'Road travel north of Kainuk carries banditry risk; movement in convoy with local liaison and daylight-only travel is required.', sections: [{ heading: 'Security', body: 'Intercommunal conflict and highway banditry along the Kainuk–Lokichar stretch. Police escorts available from Kainuk.' }, { heading: 'Medical', body: 'Nearest Level 5 hospital: Lodwar County Referral. Air evacuation window 3–4 hours.' }, { heading: 'Environment', body: 'Heat above 38 °C; carry 20 L water per vehicle and sat comms.' }], recommendations: ['Travel in daylight only', 'Convoy with police escort Kainuk–Lokichar', 'Sat phone and medevac plan briefed to all staff'], sources: [{ title: 'Kenya NDMA Turkana drought bulletin', url: 'https://www.ndma.go.ke/' }] },
  ]) {
    await prisma.intelAssessment.create({ data: { ...a, context: 'Prepared for an upcoming client movement.', model: 'demo-seed', status: 'Complete', createdById: peter.id, createdAt: at(-4) } });
  }

  // ---- messaging --------------------------------------------------------
  const direct = await prisma.conversation.create({ data: { type: 'direct', createdById: admin.id, members: { create: [{ userId: admin.id, lastReadAt: at(0, 7) }, { userId: amina.id, lastReadAt: at(0, 9) }] } } });
  const group = await prisma.conversation.create({ data: { type: 'group', title: 'Ops Control', createdById: amina.id, members: { create: [admin.id, amina.id, peter.id, faith.id].map((userId) => ({ userId, lastReadAt: at(-1) })) } } });
  const chat: Array<{ conv: number; from: number; body: string; day: number; hour: number; minute?: number }> = [
    { conv: direct.id, from: amina.id, body: 'Morning — Kilimani principal lands 06:45, Victor is at arrivals.', day: 0, hour: 6, minute: 10 },
    { conv: direct.id, from: admin.id, body: 'Thanks. Is KDA 123A fuelled?', day: 0, hour: 6, minute: 15 },
    { conv: direct.id, from: amina.id, body: 'Yes, Joseph did the inspection at 05:30. Tracker online.', day: 0, hour: 6, minute: 18 },
    { conv: direct.id, from: amina.id, body: 'Also: can you approve the Mine site quote today? Rose is waiting.', day: 0, hour: 8, minute: 2 },
    { conv: group.id, from: amina.id, body: 'Daily SITREP: all details normal. KDE 654E still in the workshop.', day: -1, hour: 18 },
    { conv: group.id, from: peter.id, body: 'Karen residence: suspicious vehicle last night, plate passed to police. Will update.', day: -1, hour: 18, minute: 12 },
    { conv: group.id, from: faith.id, body: 'Control room roster for next week is published.', day: -1, hour: 18, minute: 30 },
    { conv: group.id, from: admin.id, body: 'Good work all. Peter — add the plate to the watch list.', day: -1, hour: 19 },
    { conv: group.id, from: peter.id, body: 'Done.', day: -1, hour: 19, minute: 5 },
    { conv: group.id, from: amina.id, body: 'Turkana briefing moved to Thursday 15:00.', day: 0, hour: 8, minute: 40 },
  ];
  for (const m of chat) {
    const msg = await prisma.message.create({ data: { conversationId: m.conv, senderId: m.from, body: m.body, createdAt: at(m.day, m.hour, m.minute ?? 0) } });
    if (m.from !== admin.id && m.day === 0 && m.hour >= 8) {
      await prisma.messageNotification.create({ data: { userId: admin.id, messageId: msg.id, conversationId: m.conv, type: 'message', message: `${staffUsers.find((u) => u.id === m.from)!.name}: ${m.body.slice(0, 60)}`, createdAt: msg.createdAt } });
    }
  }

  // ---- files ------------------------------------------------------------
  const files = [
    { name: 'Turkana deployment plan.md', description: 'Movement plan, comms and medevac.', tags: ['operations', 'turkana'], mimeType: 'text/markdown', content: '# Turkana deployment plan\n\n- Convoy: KCY 456B + KDK 987F\n- Escort from Kainuk\n- Medevac: AMREF, 3–4 h window\n', shares: [amina.id, peter.id] },
    { name: 'Vehicle inspection checklist.csv', description: 'Pre-deployment checklist.', tags: ['fleet', 'safety'], mimeType: 'text/csv', content: 'item,required\nTyres and run-flats,yes\nFuel above 3/4,yes\nTracker online,yes\nTrauma kit sealed,yes\n', shares: [] },
    { name: 'Client brief — Kilimani Capital.txt', description: 'Principal profile and preferences.', tags: ['client', 'confidential'], mimeType: 'text/plain', content: 'Principal prefers the rear right seat, no music, water at room temperature. Avoid Mombasa Road after 17:00.\n', shares: [amina.id] },
  ];
  for (const f of files) {
    const buf = Buffer.from(f.content, 'utf8');
    const row = await prisma.storedFile.create({ data: { name: f.name, description: f.description, tags: f.tags, mimeType: f.mimeType, size: buf.length, content: buf, uploadedById: amina.id, shares: { create: f.shares.map((userId) => ({ userId })) } } });
    if (f.shares.length) await prisma.fileNotification.create({ data: { userId: f.shares[0], fileId: row.id, type: 'shared', message: `${amina.name} shared "${f.name}" with you` } });
  }

  // ---- map --------------------------------------------------------------
  const cats = [
    { name: 'Client sites', color: '#03458f', icon: 'building', scope: 'feature', sortOrder: 0 },
    { name: 'Hotels', color: '#9a3412', icon: 'bed', scope: 'feature', sortOrder: 1 },
    { name: 'Safe havens', color: '#047857', icon: 'shield', scope: 'feature', sortOrder: 2 },
    { name: 'Fleet', color: '#b45309', icon: 'car', scope: 'device', sortOrder: 3 },
  ];
  const catIds: number[] = [];
  for (const c of cats) {
    const row = await prisma.mapCategory.create({ data: { ...c, createdById: amina.id } });
    catIds.push(row.id);
  }
  const style = { stroke: '#03458f', strokeWidth: 2, strokeDash: 'solid', fill: '#03458f', fillOpacity: 0.15 };
  const points = [
    { name: 'Lady Askari HQ', lat: -1.2615, lng: 36.8020, cat: 0, description: 'Mwanzi Road, Westlands' },
    { name: 'Villa Rosa Kempinski', lat: -1.2680, lng: 36.8080, cat: 1, description: 'Primary client hotel' },
    { name: 'Britam Tower', lat: -1.2990, lng: 36.8120, cat: 0, description: 'Client meetings, Upper Hill' },
    { name: 'Nairobi Hospital', lat: -1.2958, lng: 36.8065, cat: 2, description: 'Level 6 trauma centre' },
    { name: 'JKIA Terminal 1A', lat: -1.3192, lng: 36.9258, cat: 0, description: 'Arrivals pick-up bay' },
    { name: 'Karen residence', lat: -1.3200, lng: 36.7080, cat: 2, description: 'Night detail post' },
  ];
  const layer = await prisma.mapLayer.create({ data: { name: 'Nairobi key sites', kind: 'drawn', visible: true, sortOrder: 0, style, featureCount: points.length, minLat: -1.32, minLng: 36.70, maxLat: -1.26, maxLng: 36.93, createdById: amina.id } });
  for (const p of points) {
    await prisma.mapFeature.create({ data: { layerId: layer.id, categoryId: catIds[p.cat], name: p.name, description: p.description, geometryType: 'Point', geometry: { type: 'Point', coordinates: [p.lng, p.lat] }, icon: cats[p.cat].icon } });
  }
  await prisma.mapGeofence.create({ data: { name: 'Westlands operating area', shape: 'polygon', geometry: { type: 'Polygon', coordinates: [[[36.79, -1.255], [36.82, -1.255], [36.82, -1.275], [36.79, -1.275], [36.79, -1.255]]] }, style: { ...style, stroke: '#047857', fill: '#047857' }, categoryId: catIds[2], createdById: amina.id } });
  await prisma.mapGeofence.create({ data: { name: 'JKIA approach', shape: 'circle', geometry: { type: 'Circle', center: [36.9258, -1.3192], radius: 1500 }, style: { ...style, stroke: '#b45309', fill: '#b45309' }, categoryId: catIds[0], createdById: amina.id } });
  await prisma.mapDeviceTag.create({ data: { device: 'KDA 123A', categoryId: catIds[3], icon: 'car', label: 'Armoured 1' } });
  await prisma.mapDeviceTag.create({ data: { device: 'KCY 456B', categoryId: catIds[3], icon: 'car', label: 'Prado' } });

  // ---- audit trail ------------------------------------------------------
  const audit = [
    { action: 'auth.login', entityType: 'user', actor: admin.id, target: admin.id, day: 0, hour: 7 },
    { action: 'auth.login', entityType: 'user', actor: amina.id, target: amina.id, day: 0, hour: 6 },
    { action: 'admin.user.created', entityType: 'user', actor: admin.id, target: faith.id, day: -40, hour: 10 },
    { action: 'admin.user.roles.updated', entityType: 'user', actor: admin.id, target: peter.id, day: -20, hour: 11 },
    { action: 'quote.approved', entityType: 'quote', entityId: String(quoteIds[1]), actor: admin.id, day: -8, hour: 9 },
    { action: 'quote.declined', entityType: 'quote', entityId: String(quoteIds[6]), actor: admin.id, day: -14, hour: 15 },
    { action: 'invoice.sent', entityType: 'invoice', entityId: String(invoiceIds[2]), actor: daniel.id, day: -5, hour: 12 },
    { action: 'invoice.payment.recorded', entityType: 'invoice', entityId: String(invoiceIds[0]), actor: daniel.id, day: -19, hour: 16 },
    { action: 'trip.created', entityType: 'trip', entityId: 'TR-0002', actor: amina.id, day: -9, hour: 14 },
    { action: 'admin.upload-limits.updated', entityType: 'settings', actor: admin.id, day: -30, hour: 10 },
    { action: 'auth.logout', entityType: 'user', actor: grace.id, target: grace.id, day: -1, hour: 18 },
    { action: 'auth.login.failed', entityType: 'user', target: daniel.id, day: -1, hour: 8, metadata: { reason: 'bad_password' } },
  ];
  for (const a of audit) {
    await prisma.auditLog.create({ data: { action: a.action, entityType: a.entityType, entityId: a.entityId, actorUserId: a.actor ?? null, targetUserId: a.target ?? null, metadata: a.metadata, ipAddress: '41.90.12.34', userAgent: 'Mozilla/5.0 (Macintosh) demo', createdAt: at(a.day, a.hour) } });
  }

  console.log('Demo data seeded.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
