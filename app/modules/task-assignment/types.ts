// Shared types for the Task Assignment module (mirror lib/task-assignment.ts).

export const VEHICLE_TYPES = ['Sedan', 'SUV', 'Van', 'Truck', 'Armoured', 'Motorcycle'] as const;
export const RESOURCE_STATUSES = ['Available', 'Assigned', 'Maintenance', 'Off duty'] as const;
export const OFFICER_GRADES = ['CPO', 'Team Leader', 'Detail Leader', 'Driver/CPO'] as const;
export const ASSIGNMENT_STATUSES = ['Planned', 'Confirmed', 'Active', 'Completed', 'Cancelled'] as const;

export type VehicleSummary = {
  id: number;
  registration: string;
  make: string | null;
  model: string | null;
  type: string;
  status: string;
  capacity: number | null;
  notes: string | null;
  hasPhoto: boolean;
  createdAt: string;
};

export type DriverSummary = {
  id: number;
  name: string;
  phone: string | null;
  licenseNumber: string | null;
  status: string;
  notes: string | null;
  hasPhoto: boolean;
  createdAt: string;
};

export type OfficerSummary = {
  id: number;
  name: string;
  callSign: string | null;
  grade: string;
  phone: string | null;
  status: string;
  notes: string | null;
  hasPhoto: boolean;
  createdAt: string;
};

export type AssignmentSummary = {
  id: number;
  tripId: number;
  status: string;
  notes: string | null;
  createdAt: string;
  trip: { id: number; reference: string; title: string; status: string; customerName: string } | null;
  vehicle: { id: number; registration: string; type: string } | null;
  driver: { id: number; name: string } | null;
  officer: { id: number; name: string; grade: string } | null;
};

export type TripOption = {
  id: number;
  reference: string;
  title: string;
  status: string;
  customerName: string;
};

export type TaskAssignmentStats = {
  trips: number;
  assignments: number;
  vehiclesAvailable: number;
  driversAvailable: number;
  officersAvailable: number;
};

export type TaskAssignmentData = {
  vehicles: VehicleSummary[];
  drivers: DriverSummary[];
  officers: OfficerSummary[];
  assignments: AssignmentSummary[];
  trips: TripOption[];
  stats: TaskAssignmentStats;
};
