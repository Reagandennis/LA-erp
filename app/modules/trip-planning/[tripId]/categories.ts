/**
 * Event categories and the fields each one actually needs.
 *
 * A flight is not a hotel is not a game drive. Travefy models seven categories
 * with genuinely different forms, and this table is the single source of truth
 * for all of them — the editor renders from it, the validator checks against
 * it, and the card reads its summary line from it.
 *
 * Shared fields (title, notes, time, place, cost, confirmation, provider) live
 * as real columns on TripItineraryItem. Only the category-specific ones below
 * go into the `details` Json column.
 */

export type TripItemCategory =
  | 'flight'
  | 'transportation'
  | 'activity'
  | 'lodging'
  | 'tour'
  | 'booking'
  | 'information';

/** The order the editor offers them in: flights, then the transport that meets them. */
export const TRIP_ITEM_CATEGORIES: TripItemCategory[] = [
  'flight',
  'transportation',
  'activity',
  'lodging',
  'tour',
  'booking',
  'information',
];

export type DetailFieldKind = 'text' | 'time' | 'number' | 'select';

export interface DetailField {
  key: string;
  label: string;
  kind: DetailFieldKind;
  placeholder?: string;
  options?: string[];
  /** Grid width in a 4-column form row. */
  span?: 1 | 2 | 3 | 4;
}

export interface CategoryMeta {
  label: string;
  /** What the "name" field is actually called for this category. */
  titleLabel: string;
  titlePlaceholder: string;
  /** What `providerName` means here. Null hides the field. */
  providerLabel: string | null;
  /** Offered in the time-label dropdown. */
  timeLabels: string[];
  /** Tailwind classes for the icon chip. */
  chip: string;
  dot: string;
  fields: DetailField[];
}

export const CATEGORY_META: Record<TripItemCategory, CategoryMeta> = {
  flight: {
    label: 'Flight',
    titleLabel: 'Route',
    titlePlaceholder: 'Nairobi → Cape Town',
    providerLabel: 'Airline',
    timeLabels: ['DEPARTURE', 'ARRIVAL'],
    chip: 'bg-sky-100 text-sky-600',
    dot: 'bg-sky-500',
    fields: [
      { key: 'flightNumber', label: 'Flight number', kind: 'text', placeholder: 'KQ 762', span: 1 },
      { key: 'cabin', label: 'Cabin', kind: 'select', options: ['Economy', 'Premium economy', 'Business', 'First'], span: 1 },
      { key: 'departAirport', label: 'From (airport)', kind: 'text', placeholder: 'NBO', span: 1 },
      { key: 'arriveAirport', label: 'To (airport)', kind: 'text', placeholder: 'CPT', span: 1 },
      { key: 'terminal', label: 'Terminal', kind: 'text', span: 1 },
      { key: 'gate', label: 'Gate', kind: 'text', span: 1 },
      { key: 'seat', label: 'Seat', kind: 'text', placeholder: '14A', span: 1 },
      { key: 'baggage', label: 'Baggage', kind: 'text', placeholder: '2 × 23kg', span: 1 },
      // The airport's zone the flight's time is written in; set by the flight form.
      { key: 'timezone', label: 'Timezone', kind: 'text', span: 2 },
    ],
  },
  lodging: {
    label: 'Hotel / lodging',
    titleLabel: 'Property',
    titlePlaceholder: 'Villa Rosa Kempinski',
    providerLabel: 'Chain / brand',
    timeLabels: ['CHECK-IN', 'CHECK-OUT'],
    chip: 'bg-violet-100 text-violet-600',
    dot: 'bg-violet-500',
    fields: [
      { key: 'roomType', label: 'Room type', kind: 'text', placeholder: 'Deluxe double', span: 2 },
      { key: 'nights', label: 'Nights', kind: 'number', span: 1 },
      { key: 'guests', label: 'Guests', kind: 'number', span: 1 },
      { key: 'checkInTime', label: 'Check-in', kind: 'time', span: 1 },
      { key: 'checkOutTime', label: 'Check-out', kind: 'time', span: 1 },
      { key: 'boardBasis', label: 'Board basis', kind: 'select', options: ['Room only', 'Bed & breakfast', 'Half board', 'Full board', 'All inclusive'], span: 2 },
    ],
  },
  transportation: {
    label: 'Transport',
    titleLabel: 'Journey',
    titlePlaceholder: 'Airport transfer to the hotel',
    providerLabel: 'Company',
    // EMPTY RUN: the vehicle moving with no passenger — out to a pick-up, back after a drop-off.
    timeLabels: ['PICK-UP', 'DROP-OFF', 'EMPTY RUN', 'DEPARTURE', 'ARRIVAL'],
    chip: 'bg-primary/10 text-primary',
    dot: 'bg-primary',
    fields: [
      { key: 'mode', label: 'Mode', kind: 'select', options: ['Car rental', 'Private transfer', 'Taxi', 'Train', 'Bus', 'Ferry', 'Other'], span: 2 },
      { key: 'vehicle', label: 'Vehicle', kind: 'text', placeholder: 'Land Cruiser', span: 2 },
      { key: 'pickupLocation', label: 'Pick-up', kind: 'text', span: 2 },
      { key: 'dropoffLocation', label: 'Drop-off', kind: 'text', span: 2 },
      { key: 'driverName', label: 'Driver', kind: 'text', span: 2 },
      { key: 'driverPhone', label: 'Driver phone', kind: 'text', span: 2 },
      { key: 'distanceKm', label: 'Distance (km)', kind: 'number', span: 1 },
    ],
  },
  tour: {
    label: 'Tour',
    titleLabel: 'Tour',
    titlePlaceholder: 'Masai Mara game drive',
    providerLabel: 'Operator',
    timeLabels: ['START', 'MEET', 'END'],
    chip: 'bg-emerald-100 text-emerald-600',
    dot: 'bg-emerald-500',
    fields: [
      { key: 'meetingPoint', label: 'Meeting point', kind: 'text', span: 4 },
      { key: 'durationText', label: 'Duration', kind: 'text', placeholder: 'Half day', span: 2 },
      { key: 'groupSize', label: 'Group size', kind: 'number', span: 1 },
      { key: 'languages', label: 'Language', kind: 'text', placeholder: 'English', span: 1 },
      { key: 'guideName', label: 'Guide', kind: 'text', span: 2 },
      { key: 'inclusions', label: 'Includes', kind: 'text', placeholder: 'Lunch, park fees', span: 2 },
    ],
  },
  booking: {
    label: 'Booking',
    titleLabel: 'Booking',
    titlePlaceholder: 'Restaurant reservation',
    providerLabel: 'Provider',
    timeLabels: ['START', 'ARRIVAL'],
    chip: 'bg-amber-100 text-amber-600',
    dot: 'bg-amber-500',
    fields: [
      { key: 'bookingRef', label: 'Booking reference', kind: 'text', span: 2 },
      { key: 'ticketType', label: 'Ticket type', kind: 'text', span: 2 },
      { key: 'partySize', label: 'Party size', kind: 'number', span: 1 },
      { key: 'dressCode', label: 'Dress code', kind: 'text', span: 3 },
    ],
  },
  activity: {
    label: 'Activity',
    titleLabel: 'Activity',
    titlePlaceholder: 'Sundowners at the escarpment',
    providerLabel: null,
    timeLabels: ['START', 'ALL DAY'],
    chip: 'bg-teal-100 text-teal-600',
    dot: 'bg-teal-500',
    fields: [
      { key: 'durationText', label: 'Duration', kind: 'text', placeholder: '2 hours', span: 2 },
      { key: 'whatToBring', label: 'What to bring', kind: 'text', span: 2 },
    ],
  },
  information: {
    label: 'Information',
    titleLabel: 'Heading',
    titlePlaceholder: 'Visas and entry requirements',
    providerLabel: null,
    timeLabels: [],
    chip: 'bg-gray-100 text-gray-500',
    dot: 'bg-gray-400',
    fields: [],
  },
};

/** A 24×24 filled icon per category, shared by the itinerary and the client's share page. */
export const CATEGORY_ICON_PATHS: Record<TripItemCategory, string> = {
  flight:
    'M21 16v-2l-8-5V3.5a1.5 1.5 0 00-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1L15 22v-1.5L13 19v-5.5L21 16z',
  transportation:
    'M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8a1 1 0 001 1h1a1 1 0 001-1v-1h12v1a1 1 0 001 1h1a1 1 0 001-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z',
  lodging:
    'M7 13c1.66 0 3-1.34 3-3S8.66 7 7 7s-3 1.34-3 3 1.34 3 3 3zm12-6h-8v7H3V5H1v15h2v-3h18v3h2v-9c0-2.21-1.79-4-4-4z',
  tour: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 010-5 2.5 2.5 0 010 5z',
  booking:
    'M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2zm0 15l-5-2.18L7 18V5h10v13z',
  activity:
    'M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4-6.2-4.6-6.2 4.6 2.4-7.4L2 9.4h7.6z',
  information:
    'M11 7h2v2h-2V7zm0 4h2v6h-2v-6zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z',
};

/** Legacy `itemType` → category. Must match the migration's CASE exactly. */
export function mapLegacyItemType(itemType: string): TripItemCategory {
  switch (itemType) {
    case 'flight':
      return 'flight';
    case 'car':
      return 'transportation';
    case 'hotel':
      return 'lodging';
    case 'location':
    case 'activity':
      return 'activity';
    default:
      return 'activity';
  }
}

export function isTripItemCategory(value: unknown): value is TripItemCategory {
  return typeof value === 'string' && (TRIP_ITEM_CATEGORIES as string[]).includes(value);
}

export function categoryMeta(category: string): CategoryMeta {
  return CATEGORY_META[isTripItemCategory(category) ? category : 'activity'];
}

/** Strip anything the category doesn't declare, so `details` can't accumulate junk. */
export function pruneDetails(
  category: TripItemCategory,
  details: Record<string, unknown> | null | undefined,
): Record<string, string> | null {
  if (!details) return null;
  const allowed = new Set(CATEGORY_META[category].fields.map((field) => field.key));
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(details)) {
    if (!allowed.has(key)) continue;
    const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
    if (text) out[key] = text;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** The one-line summary a card shows under its title. */
export function detailSummary(
  category: string,
  details: Record<string, string> | null | undefined,
): string {
  if (!details) return '';
  const meta = categoryMeta(category);
  return meta.fields
    .map((field) => {
      const value = details[field.key];
      if (!value) return null;
      switch (field.key) {
        case 'flightNumber':
        case 'roomType':
        case 'mode':
          return value;
        case 'seat':
          return `Seat ${value}`;
        case 'gate':
          return `Gate ${value}`;
        case 'terminal':
          return `Terminal ${value}`;
        case 'nights':
          return `${value} night${value === '1' ? '' : 's'}`;
        case 'guests':
          return `${value} guest${value === '1' ? '' : 's'}`;
        case 'partySize':
          return `Party of ${value}`;
        case 'cabin':
        case 'boardBasis':
        case 'durationText':
          return value;
        default:
          return null;
      }
    })
    .filter(Boolean)
    .slice(0, 3)
    .join(' · ');
}
