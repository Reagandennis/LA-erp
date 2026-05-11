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
    const body = await request.json();
    const { title, destination, startDate, endDate } = body;

    const trip = await prisma.trip.findFirst({
      where: { id: tripId, userId: auth.user.id },
    });

    if (!trip) {
      return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
    }

    const updatedTrip = await prisma.trip.update({
      where: { id: tripId },
      data: {
        title: title !== undefined ? title : trip.title,
        destination: destination !== undefined ? destination : trip.destination,
        startDate: startDate ? new Date(startDate) : trip.startDate,
        endDate: endDate ? new Date(endDate) : trip.endDate,
      },
    });

    return NextResponse.json(updatedTrip);
  } catch (error) {
    console.error('Failed to update trip:', error);
    return NextResponse.json({ error: 'Failed to update trip' }, { status: 500 });
  }
}

export async function DELETE(
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
    await prisma.trip.delete({
      where: { id: tripId, userId: auth.user.id },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete trip:', error);
    return NextResponse.json({ error: 'Failed to delete trip' }, { status: 500 });
  }
}
