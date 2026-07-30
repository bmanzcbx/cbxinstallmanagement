import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

type BookingRecord = {
  id: string;
  roomId: string;
  clientName: string;
  location: string;
  botCount: number;
  startDate: Date;
  endDate: Date;
  status: string;
};

const memoryBookings: BookingRecord[] = [];
let prisma: PrismaClient | null = null;

function getPrismaClient() {
  if (!process.env.DATABASE_URL) {
    return null;
  }

  if (!prisma) {
    const connectionString = process.env.DATABASE_URL || '';
    const adapter = new PrismaPg({ connectionString });
    prisma = new PrismaClient({ adapter });
  }

  return prisma;
}

function createMemoryBooking(
  roomId: string,
  start: Date,
  end: Date,
  details: { clientName?: string; location?: string; botCount?: number } = {}
): BookingRecord {
  const booking = {
    id: `memory-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    roomId,
    clientName: details.clientName || '',
    location: details.location || '',
    botCount: details.botCount || 0,
    startDate: start,
    endDate: end,
    status: 'PENDING_APPROVAL',
  };

  memoryBookings.push(booking);
  return booking;
}

function sortBookings(bookings: BookingRecord[]) {
  return [...bookings].sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
}

export async function createBooking(
  roomId: string,
  start: Date,
  end: Date,
  details: { clientName?: string; location?: string; botCount?: number } = {}
) {
  const client = getPrismaClient();
  if (!client) {
    const booking = createMemoryBooking(roomId, start, end, details);
    return { success: true, data: booking };
  }

  try {
    const booking = await client.booking.create({
      data: {
        roomId,
        clientName: details.clientName || '',
        location: details.location || '',
        botCount: details.botCount || 0,
        startDate: start,
        endDate: end,
        status: 'PENDING_APPROVAL',
      },
    });

    return { success: true, data: booking };
  } catch (error: any) {
    if (error.code === 'P2010' || error.message.includes('no_overlap')) {
      return {
        success: false,
        error: 'COLLISION_DETECTED',
        message: 'These dates have just been taken.',
      };
    }
    throw error;
  }
}

export async function getBookings() {
  const client = getPrismaClient();
  if (!client) {
    return { success: true, data: sortBookings(memoryBookings) };
  }

  const bookings = await client.booking.findMany({
    orderBy: { startDate: 'asc' },
  });

  return { success: true, data: bookings };
}

export async function updateBookingDates(id: string, start: Date, end: Date) {
  const client = getPrismaClient();
  if (!client) {
    const booking = memoryBookings.find((item) => item.id === id);
    if (!booking) {
      return { success: false, message: 'Booking not found.' };
    }

    booking.startDate = start;
    booking.endDate = end;
    return { success: true, data: booking };
  }

  const booking = await client.booking.update({
    where: { id },
    data: {
      startDate: start,
      endDate: end,
    },
  });

  return { success: true, data: booking };
}

export async function updateBookingDetails(
  id: string,
  details: { clientName?: string; location?: string; botCount?: number }
) {
  const client = getPrismaClient();
  if (!client) {
    const booking = memoryBookings.find((item) => item.id === id);
    if (!booking) {
      return { success: false, message: 'Booking not found.' };
    }

    if (details.clientName !== undefined) booking.clientName = details.clientName;
    if (details.location !== undefined) booking.location = details.location;
    if (details.botCount !== undefined) booking.botCount = details.botCount;
    return { success: true, data: booking };
  }

  const booking = await client.booking.update({
    where: { id },
    data: {
      clientName: details.clientName ?? undefined,
      location: details.location ?? undefined,
      botCount: details.botCount ?? undefined,
    },
  });

  return { success: true, data: booking };
}
