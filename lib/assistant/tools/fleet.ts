import 'server-only';

import { recordAuditEvent } from '@/lib/audit';
import {
  ResourceConflictError,
  createAssignment,
  createDriver,
  createOfficer,
  createVehicle,
  deleteAssignment,
  deleteDriver,
  deleteOfficer,
  deleteVehicle,
  listAssignments,
  listDrivers,
  listOfficers,
  listVehicles,
  updateAssignment,
  updateDriver,
  updateOfficer,
  updateVehicle,
} from '@/lib/task-assignment';

import { asInt, asNullableString, asString, type ToolDefinition } from '../types';

const MODULE = 'task-assignment';
const RESOURCE_STATUSES = ['Available', 'Assigned', 'Maintenance', 'Off duty'];
const ASSIGNMENT_STATUSES = ['Planned', 'Confirmed', 'Active', 'Completed', 'Cancelled'];

const listFleetTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'list_fleet',
    description: 'List vehicles (cars), drivers, close-protection officers, and current trip assignments. Use to find IDs.',
    parameters: { type: 'object', properties: {} },
  },
  async handler() {
    const [vehicles, drivers, officers, assignments] = await Promise.all([
      listVehicles(),
      listDrivers(),
      listOfficers(),
      listAssignments(),
    ]);
    return {
      vehicles: vehicles.slice(0, 40).map((v) => ({ id: v.id, registration: v.registration, type: v.type, status: v.status })),
      drivers: drivers.slice(0, 40).map((d) => ({ id: d.id, name: d.name, status: d.status })),
      officers: officers.slice(0, 40).map((o) => ({ id: o.id, name: o.name, grade: o.grade, status: o.status })),
      assignments: assignments.slice(0, 40).map((a) => ({
        id: a.id,
        status: a.status,
        trip: a.trip?.reference,
        vehicle: a.vehicle?.registration ?? null,
        driver: a.driver?.name ?? null,
        officer: a.officer?.name ?? null,
      })),
    };
  },
};

const createVehicleTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'create_vehicle',
    description: 'Add a car/vehicle to the fleet.',
    parameters: {
      type: 'object',
      properties: {
        registration: { type: 'string', description: 'Plate / registration' },
        make: { type: 'string' },
        model: { type: 'string' },
        type: { type: 'string', enum: ['Sedan', 'SUV', 'Van', 'Truck', 'Armoured', 'Motorcycle'] },
        capacity: { type: 'integer' },
      },
      required: ['registration'],
    },
  },
  async handler(args, ctx) {
    const registration = asString(args.registration);
    if (!registration) return { error: 'A registration / plate is required.' };
    const v = await createVehicle({
      userId: ctx.userId,
      registration,
      make: asNullableString(args.make),
      model: asNullableString(args.model),
      type: asString(args.type),
      capacity: asInt(args.capacity) ?? null,
    });
    await recordAuditEvent({
      action: 'ai.vehicle.create', entityType: 'Vehicle', entityId: String(v.id),
      actorUserId: ctx.userId, metadata: { registration: v.registration }, request: ctx.request,
    });
    return { id: v.id, registration: v.registration, type: v.type };
  },
};

const createDriverTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'create_driver',
    description: 'Add a driver to the roster.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        phone: { type: 'string' },
        licenseNumber: { type: 'string' },
      },
      required: ['name'],
    },
  },
  async handler(args, ctx) {
    const name = asString(args.name);
    if (!name) return { error: 'A driver name is required.' };
    const d = await createDriver({
      userId: ctx.userId,
      name,
      phone: asNullableString(args.phone),
      licenseNumber: asNullableString(args.licenseNumber),
    });
    await recordAuditEvent({
      action: 'ai.driver.create', entityType: 'Driver', entityId: String(d.id),
      actorUserId: ctx.userId, metadata: { name: d.name }, request: ctx.request,
    });
    return { id: d.id, name: d.name };
  },
};

const createOfficerTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'create_officer',
    description: 'Add a close-protection officer (CPO) to the roster.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        callSign: { type: 'string' },
        grade: { type: 'string', enum: ['CPO', 'Team Leader', 'Detail Leader', 'Driver/CPO'] },
        phone: { type: 'string' },
      },
      required: ['name'],
    },
  },
  async handler(args, ctx) {
    const name = asString(args.name);
    if (!name) return { error: 'An officer name is required.' };
    const o = await createOfficer({
      userId: ctx.userId,
      name,
      callSign: asNullableString(args.callSign),
      grade: asString(args.grade),
      phone: asNullableString(args.phone),
    });
    await recordAuditEvent({
      action: 'ai.officer.create', entityType: 'Officer', entityId: String(o.id),
      actorUserId: ctx.userId, metadata: { name: o.name }, request: ctx.request,
    });
    return { id: o.id, name: o.name, grade: o.grade };
  },
};

const createAssignmentTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'create_assignment',
    description:
      'Assign a car, driver, and/or officer to a trip. Find IDs with list_trips and list_fleet. At least one resource is required.',
    parameters: {
      type: 'object',
      properties: {
        tripId: { type: 'integer' },
        vehicleId: { type: 'integer' },
        driverId: { type: 'integer' },
        officerId: { type: 'integer' },
        notes: { type: 'string' },
      },
      required: ['tripId'],
    },
  },
  async handler(args, ctx) {
    const tripId = asInt(args.tripId);
    if (!tripId) return { error: 'A valid tripId is required (use list_trips).' };
    try {
      const a = await createAssignment({
        userId: ctx.userId,
        tripId,
        vehicleId: asInt(args.vehicleId) ?? null,
        driverId: asInt(args.driverId) ?? null,
        officerId: asInt(args.officerId) ?? null,
        notes: asNullableString(args.notes),
      });
      await recordAuditEvent({
        action: 'ai.assignment.create', entityType: 'TripAssignment', entityId: String(a.id),
        actorUserId: ctx.userId, request: ctx.request,
      });
      return { id: a.id, status: a.status, trip: a.trip?.reference };
    } catch (e) {
      if (e instanceof ResourceConflictError) return { error: e.message };
      if (e instanceof Error) return { error: e.message };
      throw e;
    }
  },
};

const deleteAssignmentTool: ToolDefinition = {
  destructive: true,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'delete_assignment',
    description: 'Remove a trip assignment.',
    parameters: {
      type: 'object',
      properties: { assignmentId: { type: 'integer' } },
      required: ['assignmentId'],
    },
  },
  async handler(args, ctx) {
    const id = asInt(args.assignmentId);
    if (!id) return { error: 'A valid assignmentId is required.' };
    const ok = await deleteAssignment(id);
    if (!ok) return { error: 'Assignment not found.' };
    await recordAuditEvent({
      action: 'ai.assignment.delete', entityType: 'TripAssignment', entityId: String(id),
      actorUserId: ctx.userId, request: ctx.request,
    });
    return { deleted: true, assignmentId: id };
  },
};

const updateVehicleTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'update_vehicle',
    description: 'Update a vehicle — registration, make, model, type, status, capacity. Provide only fields to change.',
    parameters: {
      type: 'object',
      properties: {
        vehicleId: { type: 'integer' },
        registration: { type: 'string' },
        make: { type: 'string' },
        model: { type: 'string' },
        type: { type: 'string', enum: ['Sedan', 'SUV', 'Van', 'Truck', 'Armoured', 'Motorcycle'] },
        status: { type: 'string', enum: RESOURCE_STATUSES },
        capacity: { type: 'integer' },
      },
      required: ['vehicleId'],
    },
  },
  async handler(args, ctx) {
    const id = asInt(args.vehicleId);
    if (!id) return { error: 'A valid vehicleId is required.' };
    const patch: Record<string, unknown> = {};
    if (args.registration !== undefined) patch.registration = asString(args.registration);
    if (args.make !== undefined) patch.make = asNullableString(args.make);
    if (args.model !== undefined) patch.model = asNullableString(args.model);
    if (args.type !== undefined) patch.type = asString(args.type);
    if (args.status !== undefined) patch.status = asString(args.status);
    if (args.capacity !== undefined) patch.capacity = asInt(args.capacity) ?? null;
    if (Object.keys(patch).length === 0) return { error: 'Provide at least one field to update.' };
    const v = await updateVehicle(id, patch);
    if (!v) return { error: 'Vehicle not found.' };
    await recordAuditEvent({ action: 'ai.vehicle.update', entityType: 'Vehicle', entityId: String(id), actorUserId: ctx.userId, request: ctx.request });
    return { id: v.id, registration: v.registration, status: v.status };
  },
};

const updateDriverTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'update_driver',
    description: 'Update a driver — name, phone, license number, or status. Provide only fields to change.',
    parameters: {
      type: 'object',
      properties: {
        driverId: { type: 'integer' },
        name: { type: 'string' },
        phone: { type: 'string' },
        licenseNumber: { type: 'string' },
        status: { type: 'string', enum: RESOURCE_STATUSES },
      },
      required: ['driverId'],
    },
  },
  async handler(args, ctx) {
    const id = asInt(args.driverId);
    if (!id) return { error: 'A valid driverId is required.' };
    const patch: Record<string, unknown> = {};
    if (args.name !== undefined) patch.name = asString(args.name);
    if (args.phone !== undefined) patch.phone = asNullableString(args.phone);
    if (args.licenseNumber !== undefined) patch.licenseNumber = asNullableString(args.licenseNumber);
    if (args.status !== undefined) patch.status = asString(args.status);
    if (Object.keys(patch).length === 0) return { error: 'Provide at least one field to update.' };
    const d = await updateDriver(id, patch);
    if (!d) return { error: 'Driver not found.' };
    await recordAuditEvent({ action: 'ai.driver.update', entityType: 'Driver', entityId: String(id), actorUserId: ctx.userId, request: ctx.request });
    return { id: d.id, name: d.name, status: d.status };
  },
};

const updateOfficerTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'update_officer',
    description: 'Update an officer — name, call sign, grade, phone, or status. Provide only fields to change.',
    parameters: {
      type: 'object',
      properties: {
        officerId: { type: 'integer' },
        name: { type: 'string' },
        callSign: { type: 'string' },
        grade: { type: 'string', enum: ['CPO', 'Team Leader', 'Detail Leader', 'Driver/CPO'] },
        phone: { type: 'string' },
        status: { type: 'string', enum: RESOURCE_STATUSES },
      },
      required: ['officerId'],
    },
  },
  async handler(args, ctx) {
    const id = asInt(args.officerId);
    if (!id) return { error: 'A valid officerId is required.' };
    const patch: Record<string, unknown> = {};
    if (args.name !== undefined) patch.name = asString(args.name);
    if (args.callSign !== undefined) patch.callSign = asNullableString(args.callSign);
    if (args.grade !== undefined) patch.grade = asString(args.grade);
    if (args.phone !== undefined) patch.phone = asNullableString(args.phone);
    if (args.status !== undefined) patch.status = asString(args.status);
    if (Object.keys(patch).length === 0) return { error: 'Provide at least one field to update.' };
    const o = await updateOfficer(id, patch);
    if (!o) return { error: 'Officer not found.' };
    await recordAuditEvent({ action: 'ai.officer.update', entityType: 'Officer', entityId: String(id), actorUserId: ctx.userId, request: ctx.request });
    return { id: o.id, name: o.name, status: o.status };
  },
};

const updateAssignmentTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'update_assignment',
    description: 'Update a trip assignment — change its car/driver/officer, status, or notes. Set a resource to 0 to clear it.',
    parameters: {
      type: 'object',
      properties: {
        assignmentId: { type: 'integer' },
        vehicleId: { type: 'integer' },
        driverId: { type: 'integer' },
        officerId: { type: 'integer' },
        status: { type: 'string', enum: ASSIGNMENT_STATUSES },
        notes: { type: 'string' },
      },
      required: ['assignmentId'],
    },
  },
  async handler(args, ctx) {
    const id = asInt(args.assignmentId);
    if (!id) return { error: 'A valid assignmentId is required.' };
    const patch: Record<string, unknown> = {};
    if (args.vehicleId !== undefined) patch.vehicleId = asInt(args.vehicleId) ?? null;
    if (args.driverId !== undefined) patch.driverId = asInt(args.driverId) ?? null;
    if (args.officerId !== undefined) patch.officerId = asInt(args.officerId) ?? null;
    if (args.status !== undefined) patch.status = asString(args.status);
    if (args.notes !== undefined) patch.notes = asNullableString(args.notes);
    if (Object.keys(patch).length === 0) return { error: 'Provide at least one field to update.' };
    try {
      const a = await updateAssignment(id, patch);
      if (!a) return { error: 'Assignment not found.' };
      await recordAuditEvent({ action: 'ai.assignment.update', entityType: 'TripAssignment', entityId: String(id), actorUserId: ctx.userId, request: ctx.request });
      return { id: a.id, status: a.status, trip: a.trip?.reference };
    } catch (e) {
      if (e instanceof ResourceConflictError) return { error: e.message };
      if (e instanceof Error) return { error: e.message };
      throw e;
    }
  },
};

function makeDeleteTool(opts: {
  name: string;
  description: string;
  argKey: string;
  action: string;
  entityType: string;
  remove: (id: number) => Promise<boolean>;
}): ToolDefinition {
  return {
    destructive: true,
    requiredModule: MODULE,
    functionDeclaration: {
      name: opts.name,
      description: opts.description,
      parameters: { type: 'object', properties: { [opts.argKey]: { type: 'integer' } }, required: [opts.argKey] },
    },
    async handler(args, ctx) {
      const id = asInt(args[opts.argKey]);
      if (!id) return { error: `A valid ${opts.argKey} is required.` };
      const ok = await opts.remove(id);
      if (!ok) return { error: 'Not found.' };
      await recordAuditEvent({ action: opts.action, entityType: opts.entityType, entityId: String(id), actorUserId: ctx.userId, request: ctx.request });
      return { deleted: true, id };
    },
  };
}

const deleteVehicleTool = makeDeleteTool({
  name: 'delete_vehicle', description: 'Delete a vehicle from the fleet.', argKey: 'vehicleId',
  action: 'ai.vehicle.delete', entityType: 'Vehicle', remove: deleteVehicle,
});
const deleteDriverTool = makeDeleteTool({
  name: 'delete_driver', description: 'Delete a driver from the roster.', argKey: 'driverId',
  action: 'ai.driver.delete', entityType: 'Driver', remove: deleteDriver,
});
const deleteOfficerTool = makeDeleteTool({
  name: 'delete_officer', description: 'Delete a close-protection officer from the roster.', argKey: 'officerId',
  action: 'ai.officer.delete', entityType: 'Officer', remove: deleteOfficer,
});

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
