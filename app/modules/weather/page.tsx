import { getServerAuth } from '@/lib/auth';
import { resolveWorldClockZones } from '@/lib/world-clocks';

import WeatherClient from './weather-client';

export const dynamic = 'force-dynamic';

export default async function WeatherPage() {
  const auth = await getServerAuth();
  const firstName = auth?.user.name.trim().split(/\s+/)[0] || null;
  // The same cities the top bar's world clocks show, compared on the page.
  const worldClocks = resolveWorldClockZones(auth?.preferences.worldClockZones ?? []);

  return <WeatherClient firstName={firstName} worldClocks={worldClocks} />;
}
