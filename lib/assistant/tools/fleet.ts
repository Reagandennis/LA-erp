import 'server-only';

import { API_ACCESS } from '@/lib/api-access';
import { prisma } from '@/lib/prisma';
import {
  ASSIGNMENT_STATUSES,
  OFFICER_GRADES,
  RESOURCE_STATUSES,
  ResourceConflictError,
  VEHICLE_OWNERSHIPS,
  VEHICLE_TYPES,
  createAssignment,
  createDriver,
  createOfficer,
  createVehicle,
  deleteAssignment,
  deleteDriver,
  deleteOfficer,
  deleteVehicle,
  listCurrentAssignments,
  listDrivers,
  listOfficers,
  listVehicles,
  searchAssignments,
  updateAssignment,
  updateDriver,
  updateOfficer,
  updateVehicle,
} from '@/lib/task-assignment';

import { asString, type ToolDefinition, ToolRefusal } from '../types';
import { audit, changedFields, matches, optAmount, optEnum, optId, optText, pageOf, reqId, reqText, requireChange } from './_shared';

/** Vehicles are run from their own module as well; drivers, officers and assignments only from Task Assignment. */
const VEHICLE_GATE = API_ACCESS.vehicles;
const ROSTER_GATE = API_ACCESS.taskAssignment;

const VEHICLES_HREF = '/modules/vehicles';
const ROSTER_HREF = '/modules/task-assignment';

type Args = Record<string, unknown>;

const FLEET_KINDS = ['drivers', 'officers', 'vehicles', 'assignments'] as const;
const FLEET_PAGE = 20;

/**
 * The registers behind trip crews. Searched rather than dumped: a result is
 * carried through every later step of the conversation, so the whole fleet in
 * one answer is paid for many times over.
 */
const listFleetTool: ToolDefinition = {
  destructive: false,
  kind: 'read',
  requiredModule: API_ACCESS.vehicles,
  functionDeclaration: {
    name: 'list_fleet',
    description:
      'Find drivers, close protection officers and vehicles by name, call sign or number plate, with the ids used for crew on trip events and for assignments; or list trip-level assignments. ' +
      'Give `q` to search and `kind` to narrow. With neither, returns how many of each there are.',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: [...FLEET_KINDS] },
        q: { type: 'string', description: 'Name, call sign, plate, or (assignments) trip reference or client' },
        page: { type: 'integer' },
      },
    },
  },
  async handler(args) {
    const kind = optEnum(args, 'kind', FLEET_KINDS);
    const q = asString(args.q);
    const want = (k: (typeof FLEET_KINDS)[number]) => !kind || kind === k;

    const [vehicles, drivers, officers] = await Promise.all([
      want('vehicles') ? listVehicles() : [],
      want('drivers') ? listDrivers() : [],
      want('officers') ? listOfficers() : [],
    ]);
    if (!kind && !q) {
      return {
        drivers: drivers.length,
        officers: officers.length,
        vehicles: vehicles.length,
        currentAssignments: (await listCurrentAssignments()).length,
        note: 'Search with q (a name or plate), or give a kind to list one register.',
      };
    }
    const out: Record<string, unknown> = {};
    const add = <T>(key: string, rows: T[], view: (row: T) => Record<string, unknown>) => {
      const page = pageOf(rows, args, FLEET_PAGE);
      if (kind || page.total > 0) out[key] = page.rows.map(view);
      if (page.more) out[`${key}More`] = `${page.total} in all; ask for page ${page.page + 1}, or narrow with q`;
    };
    if (want('drivers')) {
      add(
        'drivers',
        drivers.filter((d) => matches(q, d.name, d.phone)),
        (d) => ({ driverId: d.id, name: d.name, phone: d.phone, status: d.status }),
      );
    }
    if (want('officers')) {
      add(
        'officers',
        officers.filter((o) => matches(q, o.name, o.callSign, o.phone)),
        (o) => ({ officerId: o.id, name: o.name, callSign: o.callSign, grade: o.grade, phone: o.phone, status: o.status }),
      );
    }
    if (want('vehicles')) {
      add(
        'vehicles',
        vehicles.filter((v) => matches(q, v.registration, v.make, v.model, v.type)),
        (v) => ({ vehicleId: v.id, registration: v.registration, make: v.make, model: v.model, type: v.type, capacity: v.capacity, status: v.status }),
      );
    }
    if (kind === 'assignments') {
      // Without a search: what is still in play. With one: the whole history, newest first.
      const rows = q ? await searchAssignments(q) : await listCurrentAssignments();
      add('assignments', rows, (a) => ({
        assignmentId: a.id,
        status: a.status,
        tripId: a.tripId,
        trip: a.trip?.reference ?? null,
        client: a.trip?.customerName ?? null,
        dates: a.trip ? `${a.trip.startDate ?? '?'} to ${a.trip.endDate ?? '?'}` : null,
        vehicle: a.vehicle?.registration ?? null,
        driver: a.driver?.name ?? null,
        officer: a.officer?.name ?? null,
      }));
    }
    if (Object.keys(out).length === 0) return { results: [], note: `Nothing in the fleet registers matches "${q}".` };
    return out;
  },
};

// --- Shared by the register writes ---------------------------------------------------

/** The lib's own "no" (a plain Error, or a booking clash) is a refusal; anything else stays a fault. */
function relay(error: unknown): never {
  if (error instanceof ResourceConflictError) throw new ToolRefusal(error.message);
  if (error instanceof Error && error.constructor === Error) throw new ToolRefusal(error.message);
  throw error;
}

const isUniqueClash = (error: unknown) =>
  Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === 'P2002');

const plateTaken = (registration: string, vehicleId?: number) =>
  new ToolRefusal(
    `A vehicle with the number plate ${registration} is already in the fleet${vehicleId ? ` (vehicle ${vehicleId})` : ''}. Number plates are unique.`,
  );

/** Refuses a number plate another vehicle already has: the database would reject it. */
async function requireFreePlate(registration: string, exceptId?: number): Promise<void> {
  const other = await prisma.vehicle.findUnique({ where: { registration }, select: { id: true } });
  if (other && other.id !== exceptId) throw plateTaken(registration, other.id);
}

/** Runs a write, turning the lib's own refusals (and a plate taken in the meantime) into ours. */
async function attempt<T>(write: () => Promise<T>, registration?: string): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (registration && isUniqueClash(error)) throw plateTaken(registration);
    return relay(error);
  }
}

/** Text given for a field: a value sets it; null clears it where the schema allows null. */
function putText(patch: Args, args: Args, key: string, max: number): void {
  const value = optText(args, key, { max });
  if (value !== undefined) patch[key] = value;
}

const requireSomething = (patch: Args, what: string) => {
  if (Object.keys(patch).length === 0) throw new ToolRefusal(`Say what to change on the ${what}.`);
};

const VEHICLE_FACTS = {
  id: true, registration: true, make: true, model: true, type: true, status: true, capacity: true, notes: true, ownership: true,
} as const;
const DRIVER_FACTS = { id: true, name: true, phone: true, licenseNumber: true, status: true, notes: true, personnelId: true } as const;
const OFFICER_FACTS = {
  id: true, name: true, callSign: true, grade: true, phone: true, status: true, notes: true, personnelId: true,
} as const;

async function loadVehicle(id: number) {
  const row = await prisma.vehicle.findUnique({ where: { id }, select: VEHICLE_FACTS });
  if (!row) throw new ToolRefusal(`Vehicle ${id} was not found. Find vehicles with list_fleet.`);
  return row;
}

async function loadDriver(id: number) {
  const row = await prisma.driver.findUnique({ where: { id }, select: DRIVER_FACTS });
  if (!row) throw new ToolRefusal(`Driver ${id} was not found. Find drivers with list_fleet.`);
  return row;
}

async function loadOfficer(id: number) {
  const row = await prisma.officer.findUnique({ where: { id }, select: OFFICER_FACTS });
  if (!row) throw new ToolRefusal(`Officer ${id} was not found. Find officers with list_fleet.`);
  return row;
}

const REGISTER_ONLY =
  'Added to the Task Assignment register only. They do not appear in the Drivers or CPOs modules: to add a person there, use the people directory.';

/**
 * A row mirrored from the people directory is rewritten from the person the
 * next time they are saved (lib/personnel-sync.ts), so what the person owns is
 * changed on the person, not here.
 */
function refuseMirroredFields(row: { name: string; personnelId: number | null }, given: string[], module: string, free: string): void {
  if (!row.personnelId || given.length === 0) return;
  throw new ToolRefusal(
    `${row.name} comes from the people directory (person ${row.personnelId}), which owns their ${given.join(', ')}: ` +
      `a change made here is overwritten the next time the person is saved. Change it on the person in the ${module} module. ` +
      `Their ${free} can be changed here.`,
  );
}

function refuseMirroredDelete(row: { name: string; personnelId: number | null }, role: string): void {
  if (!row.personnelId) return;
  throw new ToolRefusal(
    `${row.name} comes from the people directory (person ${row.personnelId}). Deleting this row would not last: the next save of the person adds them back under a new id, and past assignments lose them. ` +
      `To take them off the roster, remove their ${role} role (or retire the person) in the people directory.`,
  );
}

// --- Vehicles ------------------------------------------------------------------------

const createVehicleTool: ToolDefinition = {
  destructive: false,
  requiredModule: VEHICLE_GATE,
  functionDeclaration: {
    name: 'create_vehicle',
    description: 'Add a vehicle to the fleet. The number plate must not already be in the fleet.',
    parameters: {
      type: 'object',
      properties: {
        registration: { type: 'string', description: 'Number plate' },
        make: { type: 'string' },
        model: { type: 'string' },
        type: { type: 'string', enum: [...VEHICLE_TYPES], description: 'Default Sedan' },
        status: { type: 'string', enum: [...RESOURCE_STATUSES], description: 'Default Available' },
        capacity: { type: 'integer', description: 'Seats' },
        ownership: { type: 'string', enum: [...VEHICLE_OWNERSHIPS], description: "Ours (Internal) or a supplier's (External)" },
        notes: { type: 'string' },
      },
      required: ['registration'],
    },
  },
  async handler(args, ctx) {
    const registration = reqText(args, 'registration', { max: 40 });
    const input = {
      userId: ctx.userId,
      registration,
      make: optText(args, 'make', { max: 80 }) ?? null,
      model: optText(args, 'model', { max: 80 }) ?? null,
      type: optEnum(args, 'type', VEHICLE_TYPES),
      status: optEnum(args, 'status', RESOURCE_STATUSES),
      capacity: optAmount(args, 'capacity', { min: 1, max: 100, integer: true }) ?? null,
      ownership: optEnum(args, 'ownership', VEHICLE_OWNERSHIPS) ?? null,
      notes: optText(args, 'notes', { max: 2000 }) ?? null,
    };
    await requireFreePlate(registration);
    const v = await attempt(() => createVehicle(input), registration);
    await audit({
      action: 'ai.vehicle.create', entityType: 'Vehicle', entityId: String(v.id),
      actorUserId: ctx.userId, metadata: { registration: v.registration }, request: ctx.request,
    });
    return {
      id: v.id,
      registration: v.registration,
      make: v.make,
      model: v.model,
      type: v.type,
      status: v.status,
      capacity: v.capacity,
      ownership: v.ownership,
      href: VEHICLES_HREF,
      summary: `Added vehicle ${v.registration} (${v.type})`,
    };
  },
};

const VEHICLE_FIELDS = ['registration', 'make', 'model', 'type', 'status', 'capacity', 'ownership', 'notes'] as const;

const updateVehicleTool: ToolDefinition = {
  destructive: false,
  requiredModule: VEHICLE_GATE,
  functionDeclaration: {
    name: 'update_vehicle',
    description: 'Change a vehicle: number plate, make, model, type, status, seats, ownership, notes. Send only what should change.',
    parameters: {
      type: 'object',
      properties: {
        vehicleId: { type: 'integer' },
        registration: { type: 'string', description: 'Number plate' },
        make: { type: 'string', description: 'null clears it', nullable: true },
        model: { type: 'string', description: 'null clears it', nullable: true },
        type: { type: 'string', enum: [...VEHICLE_TYPES] },
        status: { type: 'string', enum: [...RESOURCE_STATUSES] },
        capacity: { type: 'integer', description: 'Seats; null clears it', nullable: true },
        ownership: { type: 'string', enum: [...VEHICLE_OWNERSHIPS], description: 'null puts it back to unclassified', nullable: true },
        notes: { type: 'string', description: 'null clears them', nullable: true },
      },
      required: ['vehicleId'],
    },
  },
  async handler(args, ctx) {
    const id = reqId(args, 'vehicleId', 'use list_fleet');
    const before = await loadVehicle(id);

    const patch: Args = {};
    const registration = optText(args, 'registration', { max: 40 });
    if (registration != null) patch.registration = registration;
    putText(patch, args, 'make', 80);
    putText(patch, args, 'model', 80);
    putText(patch, args, 'notes', 2000);
    const type = optEnum(args, 'type', VEHICLE_TYPES);
    if (type) patch.type = type;
    const status = optEnum(args, 'status', RESOURCE_STATUSES);
    if (status) patch.status = status;
    if (args.capacity === null) patch.capacity = null;
    else {
      const capacity = optAmount(args, 'capacity', { min: 1, max: 100, integer: true });
      if (capacity !== undefined) patch.capacity = capacity;
    }
    if (args.ownership === null) patch.ownership = null;
    else {
      const ownership = optEnum(args, 'ownership', VEHICLE_OWNERSHIPS);
      if (ownership) patch.ownership = ownership;
    }
    requireSomething(patch, 'vehicle');
    if (registration && registration !== before.registration) await requireFreePlate(registration, id);

    const after = await attempt(() => updateVehicle(id, patch), registration ?? undefined);
    if (!after) throw new ToolRefusal(`Vehicle ${id} was not found.`);
    const changed = changedFields(before, after, VEHICLE_FIELDS);
    requireChange(changed, `vehicle ${before.registration}`);
    await audit({
      action: 'ai.vehicle.update', entityType: 'Vehicle', entityId: String(id),
      actorUserId: ctx.userId, metadata: { fields: Object.keys(changed) }, request: ctx.request,
    });
    return {
      id,
      registration: after.registration,
      changed,
      href: VEHICLES_HREF,
      summary: `Updated vehicle ${after.registration}: ${Object.keys(changed).join(', ')}`,
    };
  },
};

const deleteVehicleTool: ToolDefinition = {
  destructive: true,
  requiredModule: VEHICLE_GATE,
  confirmLabel: (args) =>
    `Delete vehicle ${asString(args.registration) ?? `#${args.vehicleId}`} from the fleet, together with its fuel logs and maintenance history (fuel-card balances change with the fuel logs)`,
  functionDeclaration: {
    name: 'delete_vehicle',
    description:
      'Delete a vehicle, with its fuel logs and maintenance history (fuel-card balances change with them). Cannot be undone. To take one out of use, set its status instead.',
    parameters: {
      type: 'object',
      properties: {
        vehicleId: { type: 'integer' },
        registration: { type: 'string', description: 'The number plate, shown to the user when they confirm' },
      },
      required: ['vehicleId'],
    },
  },
  async handler(args, ctx) {
    const id = reqId(args, 'vehicleId');
    const vehicle = await loadVehicle(id);
    const ok = await deleteVehicle(id);
    if (!ok) throw new ToolRefusal(`Vehicle ${id} was not found.`);
    await audit({
      action: 'ai.vehicle.delete', entityType: 'Vehicle', entityId: String(id),
      actorUserId: ctx.userId, metadata: { registration: vehicle.registration }, request: ctx.request,
    });
    return {
      deleted: true,
      vehicleId: id,
      href: VEHICLES_HREF,
      summary: `Deleted vehicle ${vehicle.registration} with its fuel logs and maintenance history`,
    };
  },
};

// --- Drivers and officers --------------------------------------------------------------

const createDriverTool: ToolDefinition = {
  destructive: false,
  requiredModule: ROSTER_GATE,
  functionDeclaration: {
    name: 'create_driver',
    description:
      'Add a driver to the Task Assignment register ONLY: not a person, so not shown in the Drivers module (that lists people-directory records).',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        phone: { type: 'string' },
        licenseNumber: { type: 'string' },
        status: { type: 'string', enum: [...RESOURCE_STATUSES], description: 'Default Available' },
        notes: { type: 'string' },
      },
      required: ['name'],
    },
  },
  async handler(args, ctx) {
    const input = {
      userId: ctx.userId,
      name: reqText(args, 'name', { max: 120 }),
      phone: optText(args, 'phone', { max: 40 }) ?? null,
      licenseNumber: optText(args, 'licenseNumber', { max: 60 }) ?? null,
      status: optEnum(args, 'status', RESOURCE_STATUSES),
      notes: optText(args, 'notes', { max: 2000 }) ?? null,
    };
    const d = await attempt(() => createDriver(input));
    await audit({
      action: 'ai.driver.create', entityType: 'Driver', entityId: String(d.id),
      actorUserId: ctx.userId, metadata: { name: d.name }, request: ctx.request,
    });
    return {
      id: d.id,
      name: d.name,
      phone: d.phone,
      licenseNumber: d.licenseNumber,
      status: d.status,
      note: REGISTER_ONLY,
      href: ROSTER_HREF,
      summary: `Added driver ${d.name} to the Task Assignment register`,
    };
  },
};

const createOfficerTool: ToolDefinition = {
  destructive: false,
  requiredModule: ROSTER_GATE,
  functionDeclaration: {
    name: 'create_officer',
    description:
      'Add a close protection officer to the Task Assignment register ONLY: not a person, so not shown in the CPOs module (that lists people-directory records).',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        callSign: { type: 'string' },
        grade: { type: 'string', enum: [...OFFICER_GRADES], description: 'Default CPO' },
        phone: { type: 'string' },
        status: { type: 'string', enum: [...RESOURCE_STATUSES], description: 'Default Available' },
        notes: { type: 'string' },
      },
      required: ['name'],
    },
  },
  async handler(args, ctx) {
    const input = {
      userId: ctx.userId,
      name: reqText(args, 'name', { max: 120 }),
      callSign: optText(args, 'callSign', { max: 40 }) ?? null,
      grade: optEnum(args, 'grade', OFFICER_GRADES),
      phone: optText(args, 'phone', { max: 40 }) ?? null,
      status: optEnum(args, 'status', RESOURCE_STATUSES),
      notes: optText(args, 'notes', { max: 2000 }) ?? null,
    };
    const o = await attempt(() => createOfficer(input));
    await audit({
      action: 'ai.officer.create', entityType: 'Officer', entityId: String(o.id),
      actorUserId: ctx.userId, metadata: { name: o.name }, request: ctx.request,
    });
    return {
      id: o.id,
      name: o.name,
      callSign: o.callSign,
      grade: o.grade,
      phone: o.phone,
      status: o.status,
      note: REGISTER_ONLY,
      href: ROSTER_HREF,
      summary: `Added officer ${o.name} to the Task Assignment register`,
    };
  },
};

const MIRROR_STATUS_NOTE =
  'This row mirrors a people-directory record: saving that person sets the status again from theirs (unless it is Assigned).';

const DRIVER_FIELDS = ['name', 'phone', 'licenseNumber', 'status', 'notes'] as const;

const updateDriverTool: ToolDefinition = {
  destructive: false,
  requiredModule: ROSTER_GATE,
  functionDeclaration: {
    name: 'update_driver',
    description:
      'Change a driver in the Task Assignment register: status, licence number, notes; name and phone only when they are not a people-directory record. Send only what should change.',
    parameters: {
      type: 'object',
      properties: {
        driverId: { type: 'integer' },
        name: { type: 'string' },
        phone: { type: 'string', description: 'null clears it', nullable: true },
        licenseNumber: { type: 'string', description: 'null clears it', nullable: true },
        status: { type: 'string', enum: [...RESOURCE_STATUSES] },
        notes: { type: 'string', description: 'null clears them', nullable: true },
      },
      required: ['driverId'],
    },
  },
  async handler(args, ctx) {
    const id = reqId(args, 'driverId', 'use list_fleet');
    const before = await loadDriver(id);

    const patch: Args = {};
    const name = optText(args, 'name', { max: 120 });
    if (name != null) patch.name = name;
    putText(patch, args, 'phone', 40);
    putText(patch, args, 'licenseNumber', 60);
    putText(patch, args, 'notes', 2000);
    const status = optEnum(args, 'status', RESOURCE_STATUSES);
    if (status) patch.status = status;
    requireSomething(patch, 'driver');
    refuseMirroredFields(before, ['name', 'phone'].filter((key) => key in patch), 'Drivers', 'status, licence number and notes');

    const after = await attempt(() => updateDriver(id, patch));
    if (!after) throw new ToolRefusal(`Driver ${id} was not found.`);
    const changed = changedFields(before, after, DRIVER_FIELDS);
    requireChange(changed, `driver ${before.name}`);
    await audit({
      action: 'ai.driver.update', entityType: 'Driver', entityId: String(id),
      actorUserId: ctx.userId, metadata: { fields: Object.keys(changed) }, request: ctx.request,
    });
    return {
      id,
      name: after.name,
      status: after.status,
      changed,
      ...(before.personnelId && changed.status ? { note: MIRROR_STATUS_NOTE } : {}),
      href: ROSTER_HREF,
      summary: `Updated driver ${after.name}: ${Object.keys(changed).join(', ')}`,
    };
  },
};

const OFFICER_FIELDS = ['name', 'callSign', 'grade', 'phone', 'status', 'notes'] as const;

const updateOfficerTool: ToolDefinition = {
  destructive: false,
  requiredModule: ROSTER_GATE,
  functionDeclaration: {
    name: 'update_officer',
    description:
      'Change an officer in the Task Assignment register: status, notes; name, call sign, grade and phone only when they are not a people-directory record. Send only what should change.',
    parameters: {
      type: 'object',
      properties: {
        officerId: { type: 'integer' },
        name: { type: 'string' },
        callSign: { type: 'string', description: 'null clears it', nullable: true },
        grade: { type: 'string', enum: [...OFFICER_GRADES] },
        phone: { type: 'string', description: 'null clears it', nullable: true },
        status: { type: 'string', enum: [...RESOURCE_STATUSES] },
        notes: { type: 'string', description: 'null clears them', nullable: true },
      },
      required: ['officerId'],
    },
  },
  async handler(args, ctx) {
    const id = reqId(args, 'officerId', 'use list_fleet');
    const before = await loadOfficer(id);

    const patch: Args = {};
    const name = optText(args, 'name', { max: 120 });
    if (name != null) patch.name = name;
    putText(patch, args, 'callSign', 40);
    putText(patch, args, 'phone', 40);
    putText(patch, args, 'notes', 2000);
    const grade = optEnum(args, 'grade', OFFICER_GRADES);
    if (grade) patch.grade = grade;
    const status = optEnum(args, 'status', RESOURCE_STATUSES);
    if (status) patch.status = status;
    requireSomething(patch, 'officer');
    const owned = { name: 'name', callSign: 'call sign', grade: 'grade', phone: 'phone' };
    refuseMirroredFields(
      before,
      Object.entries(owned).filter(([key]) => key in patch).map(([, label]) => label),
      'CPOs',
      'status and notes',
    );

    const after = await attempt(() => updateOfficer(id, patch));
    if (!after) throw new ToolRefusal(`Officer ${id} was not found.`);
    const changed = changedFields(before, after, OFFICER_FIELDS);
    requireChange(changed, `officer ${before.name}`);
    await audit({
      action: 'ai.officer.update', entityType: 'Officer', entityId: String(id),
      actorUserId: ctx.userId, metadata: { fields: Object.keys(changed) }, request: ctx.request,
    });
    return {
      id,
      name: after.name,
      status: after.status,
      changed,
      ...(before.personnelId && changed.status ? { note: MIRROR_STATUS_NOTE } : {}),
      href: ROSTER_HREF,
      summary: `Updated officer ${after.name}: ${Object.keys(changed).join(', ')}`,
    };
  },
};

const deleteDriverTool: ToolDefinition = {
  destructive: true,
  requiredModule: ROSTER_GATE,
  confirmLabel: (args) =>
    `Delete driver ${asString(args.name) ?? `#${args.driverId}`} from the Task Assignment register (they come off any assignments and trip events they are on)`,
  functionDeclaration: {
    name: 'delete_driver',
    description:
      'Delete a driver from the Task Assignment register (they come off their assignments and trip events). Not for people-directory drivers: those are retired there. Cannot be undone.',
    parameters: {
      type: 'object',
      properties: {
        driverId: { type: 'integer' },
        name: { type: 'string', description: "The driver's name, shown to the user when they confirm" },
      },
      required: ['driverId'],
    },
  },
  async handler(args, ctx) {
    const id = reqId(args, 'driverId');
    const driver = await loadDriver(id);
    refuseMirroredDelete(driver, 'Driver');
    const ok = await deleteDriver(id);
    if (!ok) throw new ToolRefusal(`Driver ${id} was not found.`);
    await audit({
      action: 'ai.driver.delete', entityType: 'Driver', entityId: String(id),
      actorUserId: ctx.userId, metadata: { name: driver.name }, request: ctx.request,
    });
    return { deleted: true, driverId: id, href: ROSTER_HREF, summary: `Deleted driver ${driver.name} from the Task Assignment register` };
  },
};

const deleteOfficerTool: ToolDefinition = {
  destructive: true,
  requiredModule: ROSTER_GATE,
  confirmLabel: (args) =>
    `Delete officer ${asString(args.name) ?? `#${args.officerId}`} from the Task Assignment register (they come off any assignments and trip events they are on)`,
  functionDeclaration: {
    name: 'delete_officer',
    description:
      'Delete an officer from the Task Assignment register (they come off their assignments and trip events). Not for people-directory officers: those are retired there. Cannot be undone.',
    parameters: {
      type: 'object',
      properties: {
        officerId: { type: 'integer' },
        name: { type: 'string', description: "The officer's name, shown to the user when they confirm" },
      },
      required: ['officerId'],
    },
  },
  async handler(args, ctx) {
    const id = reqId(args, 'officerId');
    const officer = await loadOfficer(id);
    refuseMirroredDelete(officer, 'CPO');
    const ok = await deleteOfficer(id);
    if (!ok) throw new ToolRefusal(`Officer ${id} was not found.`);
    await audit({
      action: 'ai.officer.delete', entityType: 'Officer', entityId: String(id),
      actorUserId: ctx.userId, metadata: { name: officer.name }, request: ctx.request,
    });
    return { deleted: true, officerId: id, href: ROSTER_HREF, summary: `Deleted officer ${officer.name} from the Task Assignment register` };
  },
};

// --- Trip-level assignments --------------------------------------------------------------

type ResourceIds = { vehicleId?: number | null; driverId?: number | null; officerId?: number | null };

/** The resource ids a call gave: a number sets, null (or 0) means none, undefined was left out. */
function readResourceIds(args: Args): ResourceIds {
  const ids: ResourceIds = {};
  for (const key of ['vehicleId', 'driverId', 'officerId'] as const) {
    const value = optId(args, key);
    if (value !== undefined) ids[key] = value;
  }
  return ids;
}

/** Refuses an id that is not in its register, so the database is never handed one it will reject. */
async function requireResources(ids: ResourceIds): Promise<void> {
  const [vehicle, driver, officer] = await Promise.all([
    ids.vehicleId ? prisma.vehicle.findUnique({ where: { id: ids.vehicleId }, select: { id: true } }) : true,
    ids.driverId ? prisma.driver.findUnique({ where: { id: ids.driverId }, select: { id: true } }) : true,
    ids.officerId ? prisma.officer.findUnique({ where: { id: ids.officerId }, select: { id: true } }) : true,
  ]);
  if (!vehicle) throw new ToolRefusal(`Vehicle ${ids.vehicleId} is not in the fleet. Find vehicles with list_fleet.`);
  if (!driver) throw new ToolRefusal(`Driver ${ids.driverId} is not in the register. Find drivers with list_fleet.`);
  if (!officer) throw new ToolRefusal(`Officer ${ids.officerId} is not in the register. Find officers with list_fleet.`);
}

const NEEDS_A_RESOURCE = 'An assignment needs at least one of a car, a driver or an officer.';

type AssignmentFacts = {
  status: string;
  notes: string | null;
  trip: { reference: string } | null;
  vehicle: { registration: string } | null;
  driver: { name: string } | null;
  officer: { name: string } | null;
};

const assignmentFacts = (a: AssignmentFacts): Record<string, unknown> => ({
  trip: a.trip?.reference ?? null,
  vehicle: a.vehicle?.registration ?? null,
  driver: a.driver?.name ?? null,
  officer: a.officer?.name ?? null,
  status: a.status,
  notes: a.notes,
});

const ASSIGNMENT_FIELDS = ['trip', 'vehicle', 'driver', 'officer', 'status', 'notes'] as const;

const heldBy = (a: AssignmentFacts) =>
  [a.vehicle?.registration, a.driver?.name, a.officer?.name].filter(Boolean).join(', ');

const createAssignmentTool: ToolDefinition = {
  destructive: false,
  requiredModule: ROSTER_GATE,
  functionDeclaration: {
    name: 'create_assignment',
    description:
      'Create a trip-level assignment in Task Assignment: a car, driver and/or officer held for a whole trip. ' +
      'This does NOT put anyone on an itinerary event: to crew a pickup, transfer or flight use save_trip_event (area: trips). ' +
      'Find ids with find_trips and list_fleet. At least one resource is required.',
    parameters: {
      type: 'object',
      properties: {
        tripId: { type: 'integer' },
        vehicleId: { type: 'integer' },
        driverId: { type: 'integer' },
        officerId: { type: 'integer' },
        status: { type: 'string', enum: [...ASSIGNMENT_STATUSES], description: 'Default Planned' },
        notes: { type: 'string' },
      },
      required: ['tripId'],
    },
  },
  async handler(args, ctx) {
    const tripId = reqId(args, 'tripId', 'use find_trips');
    const ids = readResourceIds(args);
    if (!ids.vehicleId && !ids.driverId && !ids.officerId) throw new ToolRefusal(`${NEEDS_A_RESOURCE} Find ids with list_fleet.`);
    const status = optEnum(args, 'status', ASSIGNMENT_STATUSES);
    const notes = optText(args, 'notes', { max: 2000 }) ?? null;
    await requireResources(ids);

    const a = await attempt(() =>
      createAssignment({
        userId: ctx.userId,
        tripId,
        vehicleId: ids.vehicleId ?? null,
        driverId: ids.driverId ?? null,
        officerId: ids.officerId ?? null,
        status,
        notes,
      }),
    );
    await audit({
      action: 'ai.assignment.create', entityType: 'TripAssignment', entityId: String(a.id),
      actorUserId: ctx.userId, metadata: { tripId, reference: a.trip?.reference ?? null }, request: ctx.request,
    });
    return {
      id: a.id,
      tripId: a.tripId,
      ...assignmentFacts(a),
      href: ROSTER_HREF,
      summary: `Assigned ${heldBy(a)} to trip ${a.trip?.reference ?? `#${a.tripId}`} (${a.status})`,
    };
  },
};

const updateAssignmentTool: ToolDefinition = {
  destructive: false,
  requiredModule: ROSTER_GATE,
  functionDeclaration: {
    name: 'update_assignment',
    description:
      'Change a trip-level assignment: its car, driver or officer, its status, its notes, or the trip it belongs to. ' +
      'null takes a resource off; at least one must remain (to remove the assignment use delete_assignment). Send only what should change.',
    parameters: {
      type: 'object',
      properties: {
        assignmentId: { type: 'integer' },
        tripId: { type: 'integer', description: 'Move the assignment to another trip' },
        vehicleId: { type: 'integer', description: 'null takes the car off', nullable: true },
        driverId: { type: 'integer', description: 'null takes the driver off', nullable: true },
        officerId: { type: 'integer', description: 'null takes the officer off', nullable: true },
        status: { type: 'string', enum: [...ASSIGNMENT_STATUSES] },
        notes: { type: 'string', description: 'null clears them', nullable: true },
      },
      required: ['assignmentId'],
    },
  },
  async handler(args, ctx) {
    const id = reqId(args, 'assignmentId', 'use list_fleet with kind "assignments"');
    const before = await prisma.tripAssignment.findUnique({
      where: { id },
      select: {
        id: true, tripId: true, status: true, notes: true, vehicleId: true, driverId: true, officerId: true,
        trip: { select: { reference: true } },
        vehicle: { select: { registration: true } },
        driver: { select: { name: true } },
        officer: { select: { name: true } },
      },
    });
    if (!before) throw new ToolRefusal(`Assignment ${id} was not found. Find it with list_fleet (kind "assignments").`);

    const patch: Parameters<typeof updateAssignment>[1] = { ...readResourceIds(args) };
    const tripId = optId(args, 'tripId');
    if (tripId === null) throw new ToolRefusal('An assignment always belongs to a trip: give the tripId to move it to, or leave it out.');
    if (tripId !== undefined) {
      // The lib skips a trip it cannot find without saying so.
      const trip = await prisma.trip.findUnique({ where: { id: tripId }, select: { id: true } });
      if (!trip) throw new ToolRefusal(`Trip ${tripId} was not found. Find it with find_trips.`);
      patch.tripId = tripId;
    }
    const status = optEnum(args, 'status', ASSIGNMENT_STATUSES);
    if (status) patch.status = status;
    const notes = optText(args, 'notes', { max: 2000 });
    if (notes !== undefined) patch.notes = notes;
    requireSomething(patch, 'assignment');

    const left = (key: 'vehicleId' | 'driverId' | 'officerId') => (patch[key] !== undefined ? patch[key] : before[key]);
    if (!left('vehicleId') && !left('driverId') && !left('officerId')) {
      throw new ToolRefusal(`${NEEDS_A_RESOURCE} That would leave this one with none: to remove it altogether use delete_assignment.`);
    }
    await requireResources(patch);

    const after = await attempt(() => updateAssignment(id, patch));
    if (!after) throw new ToolRefusal(`Assignment ${id} was not found.`);
    const changed = changedFields(assignmentFacts(before), assignmentFacts(after), ASSIGNMENT_FIELDS);
    requireChange(changed, `assignment ${id}`);
    await audit({
      action: 'ai.assignment.update', entityType: 'TripAssignment', entityId: String(id),
      actorUserId: ctx.userId, metadata: { fields: Object.keys(changed) }, request: ctx.request,
    });
    return {
      id,
      tripId: after.tripId,
      ...assignmentFacts(after),
      changed,
      href: ROSTER_HREF,
      summary: `Updated the assignment on trip ${after.trip?.reference ?? `#${after.tripId}`}: ${Object.keys(changed).join(', ')}`,
    };
  },
};

const deleteAssignmentTool: ToolDefinition = {
  destructive: true,
  requiredModule: ROSTER_GATE,
  confirmLabel: (args) =>
    `Remove assignment #${args.assignmentId}${asString(args.reference) ? ` from trip ${asString(args.reference)}` : ''} (the car, driver and officer on it are released)`,
  functionDeclaration: {
    name: 'delete_assignment',
    description: 'Remove a trip-level assignment, releasing the car, driver and officer on it. Cannot be undone.',
    parameters: {
      type: 'object',
      properties: {
        assignmentId: { type: 'integer' },
        reference: { type: 'string', description: "The trip's reference, shown to the user when they confirm" },
      },
      required: ['assignmentId'],
    },
  },
  async handler(args, ctx) {
    const id = reqId(args, 'assignmentId');
    const before = await prisma.tripAssignment.findUnique({ where: { id }, select: { trip: { select: { reference: true } } } });
    const ok = before ? await deleteAssignment(id) : false;
    if (!ok) throw new ToolRefusal(`Assignment ${id} was not found.`);
    const reference = before?.trip?.reference;
    await audit({
      action: 'ai.assignment.delete', entityType: 'TripAssignment', entityId: String(id),
      actorUserId: ctx.userId, metadata: { reference: reference ?? null }, request: ctx.request,
    });
    return {
      deleted: true,
      assignmentId: id,
      href: ROSTER_HREF,
      summary: `Removed assignment #${id}${reference ? ` from trip ${reference}` : ''}`,
    };
  },
};

export const fleetTools: ToolDefinition[] = [
  listFleetTool,
  createVehicleTool,
  createDriverTool,
  createOfficerTool,
  createAssignmentTool,
  updateVehicleTool,
  updateDriverTool,
  updateOfficerTool,
  updateAssignmentTool,
  deleteVehicleTool,
  deleteDriverTool,
  deleteOfficerTool,
  deleteAssignmentTool,
];
