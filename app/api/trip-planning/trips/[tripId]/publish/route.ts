import { NextResponse } from 'next/server';
import { getServerAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ tripId: string }> }
) {
  const auth = await getServerAuth();
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { tripId: rawTripId } = await params;
  const tripId = parseInt(rawTripId, 10);

  try {
    const trip = await prisma.trip.findFirst({
      where: { id: tripId, userId: auth.user.id },
      include: {
        itineraryItems: {
          orderBy: [{ dayNumber: 'asc' }, { sortOrder: 'asc' }],
        },
      },
    });

    if (!trip) {
      return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
    }

    if (trip.status === 'published') {
      return NextResponse.json({ error: 'Trip is already published' }, { status: 400 });
    }

    // 1. Update Trip status
    await prisma.trip.update({
      where: { id: tripId },
      data: { status: 'published' },
    });

    // 2. Create a PersonalTodo for the trip
    // Subtasks format as requested (JSON)
    const subtasks = trip.itineraryItems.map(item => ({
      title: `${item.title} (${item.location || item.startLocation || 'No location'})`,
      completed: false,
      id: `trip-item-${item.id}`
    }));

    await prisma.personalTodo.create({
      data: {
        userId: auth.user.id,
        tripId: trip.id,
        title: `✈️ Trip: ${trip.title}`,
        description: `Full itinerary tasks for your trip to ${trip.destination || 'Destination TBD'}.`,
        priority: 'High',
        status: 'Todo',
        dueDate: trip.startDate || new Date(),
        subtasks: subtasks as any,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to publish trip:', error);
    return NextResponse.json({ error: 'Failed to publish trip' }, { status: 500 });
  }
}
