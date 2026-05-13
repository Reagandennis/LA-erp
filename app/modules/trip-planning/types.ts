export type TripStatus = 'Draft' | 'Planned' | 'Active' | 'Completed' | 'Cancelled';

export type TripStatusFilter = 'All' | TripStatus;

export type TripItemType = 'flight' | 'car' | 'hotel' | 'location' | 'activity';

export const TRIP_ITEM_TYPES: { value: TripItemType; label: string }[] = [
  { value: 'flight', label: 'Flight' },
  { value: 'car', label: 'Car rental' },
  { value: 'hotel', label: 'Hotel / lodging' },
  { value: 'location', label: 'Place / stop' },
  { value: 'activity', label: 'Activity' },
];

export interface TripItineraryItemSummary {
  id: number;
  position: number;
  itemType: TripItemType;
  description: string;
  subtitle: string | null;
  quantity: number;
  unitPrice: number | null;
  completedAt: string | null;
  sourceQuoteItemId: number | null;
  scheduledAt: string | null;
  endsAt: string | null;
  durationMinutes: number | null;
  reminderMinutesBefore: number | null;
  reminderAt: string | null;
  imageUrl: string | null;
  confirmationCode: string | null;
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
