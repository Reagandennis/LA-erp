import 'server-only';

import type { Prisma } from '@prisma/client';
import type { z } from 'zod';

import {
  type FleetVehicleRef,
  type FuelLogDto,
  type MaintenanceDto,
  dateKeyToDate,
  defaultReminderDays,
  dateToDateKey,
  localDateKey,
} from './fleet';
import { prisma } from './prisma';
import type {
  fuelLogCreateSchema,
  fuelLogUpdateSchema,
  maintenanceCreateSchema,
  maintenanceUpdateSchema,
} from './validation';

export type FuelLogCreateInput = z.infer<typeof fuelLogCreateSchema>;
export type FuelLogUpdateInput = z.infer<typeof fuelLogUpdateSchema>;
export type MaintenanceCreateInput = z.infer<typeof maintenanceCreateSchema>;
export type MaintenanceUpdateInput = z.infer<typeof maintenanceUpdateSchema>;

/** Failures the routes pass straight back to the caller. */
export type FleetWriteResult<T> = { item: T } | { error: string; status: number };

/** The page shows the most recent fill-ups; older ones stay in the database. */
export const FUEL_LOG_LIMIT = 5000;

const VEHICLE_REF_SELECT = { id: true, registration: true, make: true, model: true } as const;
const CREATED_BY_SELECT = { select: { id: true, name: true } } as const;

const toNumber = (value: Prisma.Decimal | null): number | null => (value == null ? null : value.toNumber());
const toKey = (value: Date | null): string | null => (value ? dateToDateKey(value) : null);
const fromKey = (value: string | null | undefined): Date | null => (value ? dateKeyToDate(value) : null);
const textOrNull = (value: string | null | undefined): string | null => value?.trim() || null;

/** Every vehicle, for the pickers. */
export async function listFleetVehicles(): Promise<FleetVehicleRef[]> {
  return prisma.vehicle.findMany({ orderBy: [{ registration: 'asc' }], select: VEHICLE_REF_SELECT });
}

/**
 * Each vehicle's highest odometer reading across fill-ups and maintenance, for
 * km-based reminders. The highest, not the latest: odometers only go up.
 */
export async function listVehicleOdometers(): Promise<Record<number, number>> {
  const [fuel, work] = await Promise.all([
    prisma.vehicleFuelLog.groupBy({ by: ['vehicleId'], _max: { odometerKm: true } }),
    prisma.vehicleMaintenance.groupBy({ by: ['vehicleId'], _max: { odometerKm: true } }),
  ]);
  const readings: Record<number, number> = {};
  for (const row of [...fuel, ...work]) {
    const km = row._max.odometerKm;
    if (km != null && km > (readings[row.vehicleId] ?? -1)) readings[row.vehicleId] = km;
  }
  return readings;
}

async function vehicleExists(id: number): Promise<boolean> {
  return Boolean(await prisma.vehicle.findUnique({ where: { id }, select: { id: true } }));
}

// --- Fuel --------------------------------------------------------------------

const FUEL_SELECT = {
  id: true,
  filledAt: true,
  litres: true,
  cost: true,
  currency: true,
  odometerKm: true,
  fuelType: true,
  fullTank: true,
  station: true,
  filledBy: true,
  notes: true,
  createdAt: true,
  vehicle: { select: VEHICLE_REF_SELECT },
  createdBy: CREATED_BY_SELECT,
} as const;

type FuelRow = Prisma.VehicleFuelLogGetPayload<{ select: typeof FUEL_SELECT }>;

function serializeFuel(row: FuelRow): FuelLogDto {
  return {
    id: row.id,
    vehicle: row.vehicle,
    filledAt: row.filledAt.toISOString(),
    litres: row.litres.toNumber(),
    cost: toNumber(row.cost),
    currency: row.currency,
    odometerKm: row.odometerKm,
    fuelType: row.fuelType,
    fullTank: row.fullTank,
    station: row.station,
    filledBy: row.filledBy,
    notes: row.notes,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listFuelLogs(): Promise<FuelLogDto[]> {
  const rows = await prisma.vehicleFuelLog.findMany({
    orderBy: [{ filledAt: 'desc' }, { id: 'desc' }],
    take: FUEL_LOG_LIMIT,
    select: FUEL_SELECT,
  });
  return rows.map(serializeFuel);
}

export async function createFuelLog(userId: number, input: FuelLogCreateInput): Promise<FleetWriteResult<FuelLogDto>> {
  if (!(await vehicleExists(input.vehicleId))) return { error: 'Vehicle not found', status: 400 };
  const row = await prisma.vehicleFuelLog.create({
    data: {
      vehicleId: input.vehicleId,
      filledAt: new Date(input.filledAt),
      litres: input.litres,
      cost: input.cost ?? null,
      currency: input.currency,
      odometerKm: input.odometerKm ?? null,
      fuelType: input.fuelType,
      fullTank: input.fullTank,
      station: textOrNull(input.station),
      filledBy: textOrNull(input.filledBy),
      notes: textOrNull(input.notes),
      createdById: userId,
    },
    select: FUEL_SELECT,
  });
  return { item: serializeFuel(row) };
}

export async function updateFuelLog(id: number, input: FuelLogUpdateInput): Promise<FleetWriteResult<FuelLogDto>> {
  const existing = await prisma.vehicleFuelLog.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return { error: 'Fill-up not found', status: 404 };
  if (input.vehicleId !== undefined && !(await vehicleExists(input.vehicleId))) {
    return { error: 'Vehicle not found', status: 400 };
  }

  const data: Prisma.VehicleFuelLogUncheckedUpdateInput = {};
  if (input.vehicleId !== undefined) data.vehicleId = input.vehicleId;
  if (input.filledAt !== undefined) data.filledAt = new Date(input.filledAt);
  if (input.litres !== undefined) data.litres = input.litres;
  if (input.cost !== undefined) data.cost = input.cost;
  if (input.currency !== undefined) data.currency = input.currency;
  if (input.odometerKm !== undefined) data.odometerKm = input.odometerKm;
  if (input.fuelType !== undefined) data.fuelType = input.fuelType;
  if (input.fullTank !== undefined) data.fullTank = input.fullTank;
  if (input.station !== undefined) data.station = textOrNull(input.station);
  if (input.filledBy !== undefined) data.filledBy = textOrNull(input.filledBy);
  if (input.notes !== undefined) data.notes = textOrNull(input.notes);

  const row = await prisma.vehicleFuelLog.update({ where: { id }, data, select: FUEL_SELECT });
  return { item: serializeFuel(row) };
}

export async function deleteFuelLog(id: number): Promise<boolean> {
  const { count } = await prisma.vehicleFuelLog.deleteMany({ where: { id } });
  return count > 0;
}

// --- Maintenance -------------------------------------------------------------

const MAINTENANCE_SELECT = {
  id: true,
  kind: true,
  category: true,
  title: true,
  status: true,
  scheduledFor: true,
  completedAt: true,
  odometerKm: true,
  cost: true,
  currency: true,
  provider: true,
  nextDueAt: true,
  nextDueKm: true,
  reminderDays: true,
  notes: true,
  createdAt: true,
  vehicle: { select: VEHICLE_REF_SELECT },
  createdBy: CREATED_BY_SELECT,
} as const;

type MaintenanceRow = Prisma.VehicleMaintenanceGetPayload<{ select: typeof MAINTENANCE_SELECT }>;

function serializeMaintenance(row: MaintenanceRow): MaintenanceDto {
  return {
    id: row.id,
    vehicle: row.vehicle,
    kind: row.kind,
    category: row.category,
    title: row.title,
    status: row.status,
    scheduledFor: toKey(row.scheduledFor),
    completedAt: toKey(row.completedAt),
    odometerKm: row.odometerKm,
    cost: toNumber(row.cost),
    currency: row.currency,
    provider: row.provider,
    nextDueAt: toKey(row.nextDueAt),
    nextDueKm: row.nextDueKm,
    reminderDays: row.reminderDays,
    notes: row.notes,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * A completed job always carries the day it was done (today when none is
 * given); any other status carries none, so reopening a job clears it.
 */
export function resolveCompletedAt(status: string, completedAt: string | null, today: string): string | null {
  if (status !== 'Completed') return null;
  return completedAt || today;
}

export async function listMaintenance(): Promise<MaintenanceDto[]> {
  const rows = await prisma.vehicleMaintenance.findMany({
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: MAINTENANCE_SELECT,
  });
  return rows.map(serializeMaintenance);
}

export async function createMaintenance(
  userId: number,
  input: MaintenanceCreateInput,
  today: string = localDateKey(),
): Promise<FleetWriteResult<MaintenanceDto>> {
  if (!(await vehicleExists(input.vehicleId))) return { error: 'Vehicle not found', status: 400 };
  const row = await prisma.vehicleMaintenance.create({
    data: {
      vehicleId: input.vehicleId,
      kind: input.kind,
      category: input.category,
      title: input.title,
      status: input.status,
      scheduledFor: fromKey(input.scheduledFor),
      completedAt: fromKey(resolveCompletedAt(input.status, input.completedAt ?? null, today)),
      odometerKm: input.odometerKm ?? null,
      cost: input.cost ?? null,
      currency: input.currency,
      provider: textOrNull(input.provider),
      nextDueAt: fromKey(input.nextDueAt),
      nextDueKm: input.nextDueKm ?? null,
      reminderDays: input.reminderDays !== undefined ? input.reminderDays : defaultReminderDays(input.category),
      notes: textOrNull(input.notes),
      createdById: userId,
    },
    select: MAINTENANCE_SELECT,
  });
  return { item: serializeMaintenance(row) };
}

export async function updateMaintenance(
  id: number,
  input: MaintenanceUpdateInput,
  today: string = localDateKey(),
): Promise<FleetWriteResult<MaintenanceDto>> {
  const existing = await prisma.vehicleMaintenance.findUnique({
    where: { id },
    select: { status: true, completedAt: true },
  });
  if (!existing) return { error: 'Maintenance record not found', status: 404 };
  if (input.vehicleId !== undefined && !(await vehicleExists(input.vehicleId))) {
    return { error: 'Vehicle not found', status: 400 };
  }

  const data: Prisma.VehicleMaintenanceUncheckedUpdateInput = {};
  if (input.vehicleId !== undefined) data.vehicleId = input.vehicleId;
  if (input.kind !== undefined) data.kind = input.kind;
  if (input.category !== undefined) data.category = input.category;
  if (input.title !== undefined) data.title = input.title;
  if (input.status !== undefined) data.status = input.status;
  if (input.scheduledFor !== undefined) data.scheduledFor = fromKey(input.scheduledFor);
  if (input.odometerKm !== undefined) data.odometerKm = input.odometerKm;
  if (input.cost !== undefined) data.cost = input.cost;
  if (input.currency !== undefined) data.currency = input.currency;
  if (input.provider !== undefined) data.provider = textOrNull(input.provider);
  if (input.nextDueAt !== undefined) data.nextDueAt = fromKey(input.nextDueAt);
  if (input.nextDueKm !== undefined) data.nextDueKm = input.nextDueKm;
  if (input.reminderDays !== undefined) data.reminderDays = input.reminderDays;
  if (input.notes !== undefined) data.notes = textOrNull(input.notes);
  data.completedAt = fromKey(
    resolveCompletedAt(
      input.status ?? existing.status,
      input.completedAt !== undefined ? input.completedAt : toKey(existing.completedAt),
      today,
    ),
  );

  const row = await prisma.vehicleMaintenance.update({ where: { id }, data, select: MAINTENANCE_SELECT });
  return { item: serializeMaintenance(row) };
}

export async function deleteMaintenance(id: number): Promise<boolean> {
  const { count } = await prisma.vehicleMaintenance.deleteMany({ where: { id } });
  return count > 0;
}
