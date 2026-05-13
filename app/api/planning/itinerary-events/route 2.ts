import { NextResponse } from 'next/server';
import { getServerAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const auth = await getServerAuth();
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const tripItems = await prisma.tripItineraryItem.findMany({
      where: {
        trip: {
          userId: auth.user.id,
          status: 'published',
        },
      },
      include: {
        trip: true,
      },
      orderBy: {
        startTime: 'asc',
      },
    });

    // Map to a format the calendar can use
    const events = tripItems.map(item => ({
      id: `itinerary-${item.id}`,
      title: `${item.title} (${item.trip.title})`,
      date: item.startTime ? item.startTime.toISOString().split('T')[0] : null,
      time: item.startTime ? item.startTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) : null,
      type: (item as any).itemType,
      tripId: item.tripId,
    }));

    return NextResponse.json(events);
  } catch (error) {
    console.error('Failed to fetch itinerary events:', error);
    return NextResponse.json({ error: 'Failed to fetch itinerary events' }, { status: 500 });
  }
}
