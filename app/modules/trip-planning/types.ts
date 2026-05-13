export type TripStatus = 'Draft' | 'Planned' | 'Active' | 'Completed' | 'Cancelled';

export type TripStatusFilter = 'All' | TripStatus;

export interface TripItineraryItemSummary {
  id: number;
  position: number;
  description: string;
  quantity: number;
  unitPrice: number | null;
  completedAt: string | null;
  sourceQuoteItemId: number | null;
  scheduledAt: string | null;
  durationMinutes: number | null;
  reminderMinutesBefore: number | null;
  reminderAt: string | null;
}

export const REMINDER_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: 'No reminder' },
  { value: 5, label: '5 min before' },
  { value: 15, label: '15 min before' },
  { value: 30, label: '30 min before' },
  { value: 60, label: '1 hour before' },
  { value: 1440, label: '1 day before' },
];

export interface TripSummary {
  id: number;
  reference: string;
  trackingCode: string;
  title: string;
  description: string | null;
  status: TripStatus;
  currency: string;
  startDate: string | null;
  endDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  customer: { id: number; name: string; company: string | null; email: string | null };
  createdBy: { id: number; name: string; email: string };
  owner: { id: number; name: string; email: string } | null;
  sourceQuote: { id: number; reference: string } | null;
  itemCount: number;
}

export interface TripDetail extends TripSummary {
  items: TripItineraryItemSummary[];
}

export interface OwnerOption {
  id: number;
  name: string;
  email: string;
}
