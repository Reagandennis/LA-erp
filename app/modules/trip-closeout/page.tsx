import { redirect } from 'next/navigation';

/** Trip Close Out is a grant on Trip Planning: its link opens that module's Close out tab. */
export default function TripCloseoutPage() {
  redirect('/modules/trip-planning?tab=close-out');
}
