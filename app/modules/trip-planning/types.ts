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

export interface TripDaySummary {
  id: number;
  /** "YYYY-MM-DD", or null while the trip's dates are TBD. */
  dateKey: string | null;
  /** Dense 1..N — the ordering key and the "Day 3" label. */
  dayNumber: number;
  title: string | null;
  summary: string | null;
}

export interface TripItineraryItemSummary {
  id: number;
  dayId: number | null;
  position: number;
  /** Legacy 5-value type, kept for one release. New code reads `category`. */
  itemType: TripItemType;
  category: string;
  body: string | null;
  timeLabel: string | null;
  providerName: string | null;
  bookingUrl: string | null;
  phone: string | null;
  placeName: string | null;
  address: string | null;
  details: Record<string, string> | null;
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
  assignmentCount: number;
  /** Entries in the trip's operations log. */
  logCount: number;
}

export interface TripDetail extends TripSummary {
  items: TripItineraryItemSummary[];
  days: TripDaySummary[];
  /** Item costs were left out: the viewer doesn't have access to quotes. */
  costsHidden?: boolean;
}

export interface OwnerOption {
  id: number;
  name: string;
  email: string;
}
