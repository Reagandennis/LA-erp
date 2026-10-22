import type { TripItemAttachmentSummary } from '../types';
import type { TripItemCategory } from './categories';

/** One of the client's travellers, or a new name that joins the trip on save. */
export interface EventTraveler {
  travelerId?: number;
  name: string;
}

/** The event editor's form, as typed. */
export interface EditorState {
  category: TripItemCategory;
  description: string;
  subtitle: string;
  body: string;
  timeLabel: string;
  providerName: string;
  phone: string;
  bookingUrl: string;
  placeName: string;
  address: string;
  date: string;
  time: string;
  endTime: string;
  reminderMinutesBefore: string;
  imageUrl: string;
  confirmationCode: string;
  unitPrice: string;
  /** Category-specific values, keyed by the field spec in categories.ts. */
  details: Record<string, string>;
  /** The trip day the event sits on; null is the unscheduled tray. */
  dayId: number | null;
  /** The IANA zone a flight's date and time are in. Other events use the viewer's clock. */
  timezone: string;
  /** Flight time, as typed. */
  durationHours: string;
  durationMinutes: string;
  /** Photos and documents already on the event. */
  attachments: TripItemAttachmentSummary[];
  /** Saved ones to delete when the event saves. */
  removedAttachmentIds: number[];
  /** Picked here; uploaded once the event itself has saved. */
  newFiles: File[];
  /** Crew from Task Assignment, for flights and transport. */
  driverId: number | null;
  officerId: number | null;
  vehicleId: number | null;
  /** Who the event is for; none is the whole party. */
  travelers: EventTraveler[];
}
