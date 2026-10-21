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
  /** Photos and documents, oldest first. */
  attachments: TripItemAttachmentSummary[];
  /** The crew on this movement, from Task Assignment's registers. */
  driver: { id: number; name: string; phone: string | null } | null;
  officer: { id: number; name: string; callSign: string | null; grade: string; phone: string | null } | null;
  vehicle: { id: number; registration: string; make: string | null; model: string | null; type: string } | null;
}

/** A driver, CPO or vehicle offered by the crew pickers (see lib/trip-crew). */
export interface CrewOption {
  id: number;
  label: string;
  hint: string | null;
  status: string;
  /** Allocated to this trip in Task Assignment. */
  onTrip: boolean;
  /** Another trip it's actively assigned to. */
  busyOn: string | null;
}

export interface CrewOptions {
  drivers: CrewOption[];
  officers: CrewOption[];
  vehicles: CrewOption[];
}

export interface TripItemAttachmentSummary {
  id: number;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: string;
  /** Opens the file: inline for images, PDFs and text, otherwise a download. */
  url: string;
  /** A small preview for images; null for documents. */
  thumbnailUrl: string | null;
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
  /** The client's travellers on this trip, lead first. */
  travelers: { id: number; name: string; isPrimary: boolean }[];
  createdBy: { id: number; name: string; email: string };
  owner: { id: number; name: string; email: string } | null;
  sourceQuote: { id: number; reference: string } | null;
  itemCount: number;
  assignmentCount: number;
  /** Entries in the trip's operations log. */
  logCount: number;
}

/** One page of the list from GET /api/trips?q=&status=&page= (mirrors lib/trips.ts). */
export interface TripPage {
  trips: TripSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export type TripStatusCounts = Record<TripStatus, number> & { total: number };

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

/** A client's traveller, as the trip builder offers them. */
export interface TravelerOption {
  id: number;
  name: string;
  customerId: number;
}

/** The trip list page's tabs. Close out needs the Trip Close Out grant. */
export type TripsTab = 'trips' | 'close-out';

/** A trip's verification after completion (see lib/trip-closeout). */
export interface TripCloseout {
  /** Keys of CLOSEOUT_CHECKS in lib/trip-closeout-checks. */
  checks: string[];
  summary: string | null;
  issues: string | null;
  clientFeedback: string | null;
  /** Null while the close-out is still open. */
  closedAt: string | null;
  closedBy: { id: number; name: string } | null;
  updatedAt: string;
  updatedBy: { id: number; name: string } | null;
}

/** A trip on the Close out tab: completed, or already closed out. */
export interface CloseoutTrip {
  id: number;
  reference: string;
  trackingCode: string;
  title: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  customer: { name: string; company: string | null };
  /** Lead first. */
  travelers: string[];
  owner: { id: number; name: string } | null;
  itemCount: number;
  logCount: number;
  /** The viewer may open the itinerary page. */
  canOpen: boolean;
  closeout: TripCloseout | null;
}

/** The client's link to an active trip (see lib/trip-share). */
export interface TripShareLink {
  /** "/share/trip/<token>", without the origin. */
  path: string;
  /** Crew names and phones, vehicles and item notes. */
  includeCrew: boolean;
  /** Each stop's photos and documents. */
  includeAttachments: boolean;
  createdAt: string;
  createdBy: { id: number; name: string } | null;
  viewCount: number;
  lastViewedAt: string | null;
}
