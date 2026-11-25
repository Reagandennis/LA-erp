import 'server-only';

import { API_ACCESS } from '@/lib/api-access';
import { SOP_CATEGORIES, SOP_STATUSES, getSop, listSops } from '@/lib/sops';
import { RISK_LEVELS, TRAVELER_STATUSES } from '@/lib/traveler-options';
import { getTravelerById, searchTravelers } from '@/lib/travelers';
import { VENDOR_STATUSES } from '@/lib/trip-resource-model';
import { getVendorRegister, listCatalogServices } from '@/lib/vendors';

import { asString, type ToolDefinition, ToolRefusal } from '../types';
import { localStamp, matches, optAmount, optEnum, optFlag, pageOf, reqId } from './_shared';

/** The registers people look things up in, read only: Travelers, Vendors/Suppliers and SOPs. */
const PAGE_SIZE = 20;

const clip = (text: string | null, max: number) => (text && text.length > max ? `${text.slice(0, max)}…` : text);
/** A date-only value, saved at midnight UTC. */
const day10 = (iso: string | null) => (iso ? iso.slice(0, 10) : null);

// --- Travelers ---------------------------------------------------------------------

/**
 * Travellers are the people we protect, behind their own grant. The route
 * (app/api/travelers) gives a holder of the module the list and the full
 * record; these give the same and nothing more.
 */
const TRAVELERS_MODULE = 'travelers';
const travelerHref = (id: number) => `/modules/travelers?open=${id}`;

const findTravelersTool: ToolDefinition = {
  destructive: false,
  kind: 'read',
  requiredModule: TRAVELERS_MODULE,
  functionDeclaration: {
    name: 'find_travelers',
    description:
      'Find travellers (the people we protect) by name, email, phone, nationality or client; filter by risk level or status. Returns contact details, client, risk, passport expiry and ids for get_traveler. 20 per page, by name.',
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Name, email, phone, nationality, client name or company' },
        risk: { type: 'string', enum: [...RISK_LEVELS] },
        status: { type: 'string', enum: [...TRAVELER_STATUSES] },
        page: { type: 'integer' },
      },
    },
  },
  async handler(args) {
    const q = asString(args.q) ?? null;
    const risk = optEnum(args, 'risk', RISK_LEVELS) ?? null;
    const status = optEnum(args, 'status', TRAVELER_STATUSES) ?? null;
    const asked = optAmount(args, 'page', { min: 1, integer: true });
    const result = await searchTravelers({ q, risk, status, page: asked ?? 1, pageSize: PAGE_SIZE });
    // The whole directory with nothing to narrow it: say how many, not who.
    if (!q && !risk && !status && asked === undefined && result.total > PAGE_SIZE) {
      return {
        total: result.total,
        note: 'Search by name, client, nationality, phone or email, or filter by risk or status. Pass a page to read the directory in name order.',
        href: '/modules/travelers',
      };
    }
    return {
      total: result.total,
      page: result.page,
      more: result.page * result.pageSize < result.total,
      travellers: result.items.map((traveller) => ({
        id: traveller.id,
        name: traveller.name,
        client: traveller.customer ? (traveller.customer.company ?? traveller.customer.name) : null,
        nationality: traveller.nationality,
        phone: traveller.phone,
        email: traveller.email,
        status: traveller.status,
        risk: traveller.riskLevel,
        passportExpires: day10(traveller.passportExpiry),
        trips: traveller.tripCount,
        href: travelerHref(traveller.id),
      })),
    };
  },
};

const getTravelerTool: ToolDefinition = {
  destructive: false,
  kind: 'read',
  requiredModule: TRAVELERS_MODULE,
  functionDeclaration: {
    name: 'get_traveler',
    description:
      "One traveller's record: contact details, client, risk level, nationality, passport expiry, dietary notes and trip count. Passport number, date of birth, medical notes, emergency contact and free notes are never sent to chat: the result says which of them are on file and links to the record.",
    parameters: {
      type: 'object',
      properties: { travelerId: { type: 'integer' } },
      required: ['travelerId'],
    },
  },
  async handler(args) {
    const id = reqId(args, 'travelerId', 'use find_travelers');
    const traveller = await getTravelerById(id);
    if (!traveller) throw new ToolRefusal(`Traveller ${id} was not found. Find them with find_travelers.`);
    // Travellers are protectees. What identifies or exposes them stays in the
    // platform: the model (an outside service) is told only that it exists.
    const withheld = [
      traveller.passportNumber && 'passport number',
      traveller.dateOfBirth && 'date of birth',
      traveller.medicalNotes && 'medical notes',
      traveller.emergencyContactName && 'emergency contact',
      traveller.notes && 'notes',
    ].filter((field): field is string => Boolean(field));
    return {
      id: traveller.id,
      name: traveller.name,
      client: traveller.customer ? { id: traveller.customer.id, name: traveller.customer.name, company: traveller.customer.company } : null,
      status: traveller.status,
      risk: traveller.riskLevel,
      phone: traveller.phone,
      email: traveller.email,
      nationality: traveller.nationality,
      passportExpires: day10(traveller.passportExpiry),
      dietaryNotes: clip(traveller.dietaryNotes, 600),
      trips: traveller.tripCount,
      ...(withheld.length > 0
        ? { onFileButNotShownHere: withheld, note: 'Open the record in the Travelers module to see those; they are not available in chat.' }
        : {}),
      href: travelerHref(traveller.id),
    };
  },
};

export const travelerTools: ToolDefinition[] = [findTravelersTool, getTravelerTool];

// --- Vendors/Suppliers -------------------------------------------------------------

const VENDORS_HREF = '/modules/vendors-suppliers';
const SHOWN = 30;

const findVendorsTool: ToolDefinition = {
  destructive: false,
  kind: 'read',
  requiredModule: API_ACCESS.vendors,
  functionDeclaration: {
    name: 'find_vendors',
    description:
      'The vendor register: who supplies our services, vehicles and people. Search by name or contact; filter by status or country. Returns contact details and how many services, vehicles, people and trips each has. 20 per page.',
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Vendor name, contact person, email or phone' },
        status: { type: 'string', enum: [...VENDOR_STATUSES], description: 'Only Approved vendors reach a trip' },
        country: { type: 'string', description: 'A country the vendor covers, e.g. Kenya' },
        externalOnly: { type: 'boolean', description: 'Leave out our own (internal) fleet and staff' },
        page: { type: 'integer' },
      },
    },
  },
  async handler(args) {
    const q = asString(args.q);
    const status = optEnum(args, 'status', VENDOR_STATUSES);
    const country = asString(args.country)?.toLowerCase();
    const externalOnly = optFlag(args, 'externalOnly') ?? false;
    const register = await getVendorRegister();
    const wanted = register.vendors.filter(
      (vendor) =>
        (!status || vendor.status === status) &&
        (!externalOnly || !vendor.internal) &&
        (!country || vendor.countries.some((c) => c.toLowerCase() === country)) &&
        matches(q, vendor.name, vendor.contactName, vendor.email, vendor.phone),
    );
    const { rows, page, total, more } = pageOf(wanted, args, PAGE_SIZE);
    return {
      total,
      page,
      more,
      vendors: rows.map((vendor) => ({
        id: vendor.id,
        name: vendor.name,
        ...(vendor.internal ? { internal: true } : {}),
        status: vendor.status,
        countries: vendor.countries,
        contact: vendor.contactName,
        phone: vendor.phone,
        email: vendor.email,
        services: vendor.serviceIds.length,
        vehicles: register.vehicles.filter((vehicle) => vehicle.vendorId === vendor.id).length,
        people: register.people.filter((person) => person.vendorId === vendor.id).length,
        trips: vendor.tripCount,
      })),
      href: VENDORS_HREF,
    };
  },
};

const getVendorTool: ToolDefinition = {
  destructive: false,
  kind: 'read',
  requiredModule: API_ACCESS.vendors,
  functionDeclaration: {
    name: 'get_vendor',
    description: 'One vendor: status, countries, contact details, notes, the services in its catalog, and the vehicles and people tagged to it.',
    parameters: {
      type: 'object',
      properties: { vendorId: { type: 'integer' } },
      required: ['vendorId'],
    },
  },
  async handler(args) {
    const id = reqId(args, 'vendorId', 'use find_vendors');
    // The register and the catalog, as the Vendors/Suppliers page loads them.
    const [register, catalog] = await Promise.all([getVendorRegister(), listCatalogServices()]);
    const vendor = register.vendors.find((row) => row.id === id);
    if (!vendor) throw new ToolRefusal(`Vendor ${id} was not found. Find it with find_vendors.`);
    const services = catalog.filter((service) => vendor.serviceIds.includes(service.id));
    const vehicles = register.vehicles.filter((vehicle) => vehicle.vendorId === id);
    const people = register.people.filter((person) => person.vendorId === id);
    return {
      id: vendor.id,
      name: vendor.name,
      internal: vendor.internal,
      status: vendor.status,
      countries: vendor.countries,
      contact: vendor.contactName,
      phone: vendor.phone,
      email: vendor.email,
      notes: clip(vendor.notes, 800),
      trips: vendor.tripCount,
      serviceCount: vendor.serviceIds.length,
      services: services.slice(0, SHOWN).map((service) => ({
        id: service.id,
        name: service.name,
        ...(service.code ? { code: service.code } : {}),
        ...(service.country ? { country: service.country } : {}),
      })),
      vehicleCount: vehicles.length,
      vehicles: vehicles.slice(0, SHOWN).map((vehicle) => ({
        id: vehicle.id,
        registration: vehicle.registration,
        model: [vehicle.make, vehicle.model].filter(Boolean).join(' ') || null,
        type: vehicle.type,
      })),
      peopleCount: people.length,
      people: people.slice(0, SHOWN).map((person) => ({ id: person.id, name: person.name, roles: person.roles, status: person.status })),
      ...(services.length > SHOWN || vehicles.length > SHOWN || people.length > SHOWN ? { note: `Lists are cut at ${SHOWN}; the counts are complete.` } : {}),
      updated: day10(vendor.updatedAt),
      href: VENDORS_HREF,
    };
  },
};

export const vendorTools: ToolDefinition[] = [findVendorsTool, getVendorTool];

// --- SOPs --------------------------------------------------------------------------

const sopHref = (id: number) => `/modules/sops?open=${id}`;

const listSopsTool: ToolDefinition = {
  destructive: false,
  kind: 'read',
  requiredModule: API_ACCESS.sops,
  functionDeclaration: {
    name: 'list_sops',
    description:
      'Standard operating procedures, by code: title, category, status, version, owner, review date, and whether the user has acknowledged the current version. Search and filter. 20 per page.',
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Code, title, owner or words in the description' },
        category: { type: 'string', enum: [...SOP_CATEGORIES] },
        status: { type: 'string', enum: [...SOP_STATUSES] },
        notAcknowledged: { type: 'boolean', description: 'Only procedures the user has still to acknowledge' },
        page: { type: 'integer' },
      },
    },
  },
  async handler(args, ctx) {
    const q = asString(args.q);
    const category = optEnum(args, 'category', SOP_CATEGORIES);
    const status = optEnum(args, 'status', SOP_STATUSES);
    const notAcknowledged = optFlag(args, 'notAcknowledged') ?? false;
    const sops = await listSops(ctx.userId);
    const wanted = sops.filter(
      (sop) =>
        (!category || sop.category === category) &&
        (!status || sop.status === status) &&
        (!notAcknowledged || !sop.acknowledgedByMe) &&
        matches(q, sop.code, sop.title, sop.ownerName, sop.description),
    );
    const { rows, page, total, more } = pageOf(wanted, args, PAGE_SIZE);
    return {
      total,
      page,
      more,
      reviewOverdue: wanted.filter((sop) => sop.reviewOverdue).length,
      sops: rows.map((sop) => ({
        id: sop.id,
        code: sop.code,
        title: sop.title,
        category: sop.category,
        status: sop.status,
        version: sop.version,
        owner: sop.ownerName,
        steps: sop.stepCount,
        review: day10(sop.reviewDate),
        ...(sop.reviewOverdue ? { reviewOverdue: true } : {}),
        acknowledgedByUser: sop.acknowledgedByMe,
        href: sopHref(sop.id),
      })),
    };
  },
};

const STEPS_SHOWN = 60;

const getSopTool: ToolDefinition = {
  destructive: false,
  kind: 'read',
  requiredModule: API_ACCESS.sops,
  functionDeclaration: {
    name: 'get_sop',
    description: 'Read one procedure: its description, every step in order, version, dates, recent revisions, and how many people have acknowledged it. Does not acknowledge it.',
    parameters: {
      type: 'object',
      properties: { sopId: { type: 'integer' } },
      required: ['sopId'],
    },
  },
  async handler(args, ctx) {
    const id = reqId(args, 'sopId', 'use list_sops');
    const sop = await getSop(id, ctx.userId);
    if (!sop) throw new ToolRefusal(`Procedure ${id} was not found. Find it with list_sops.`);
    return {
      id: sop.id,
      code: sop.code,
      title: sop.title,
      category: sop.category,
      status: sop.status,
      version: sop.version,
      owner: sop.ownerName,
      description: clip(sop.description, 1500),
      steps: sop.steps.slice(0, STEPS_SHOWN).map((step, index) => `${index + 1}. ${clip(step, 500)}`),
      ...(sop.steps.length > STEPS_SHOWN ? { note: `Showing the first ${STEPS_SHOWN} of ${sop.steps.length} steps.` } : {}),
      effective: day10(sop.effectiveDate),
      review: day10(sop.reviewDate),
      reviewOverdue: sop.reviewOverdue,
      acknowledgedByUser: sop.acknowledgedByMe,
      acknowledged: `${sop.ackCount} of ${sop.totalUsers} people (current version)`,
      revisions: sop.revisions.slice(0, 5).map((revision) => ({
        version: revision.version,
        summary: clip(revision.summary, 200),
        by: revision.changedBy,
        when: localStamp(revision.createdAt, ctx.timeZone),
      })),
      href: sopHref(sop.id),
    };
  },
};

export const sopTools: ToolDefinition[] = [listSopsTool, getSopTool];
