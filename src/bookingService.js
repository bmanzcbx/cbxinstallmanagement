const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

dotenv.config();

const connectionString = process.env.DATABASE_URL;
const memoryBookings = [];
let prisma = null;

if (connectionString) {
  const adapter = new PrismaPg({ connectionString });
  prisma = new PrismaClient({ adapter });
}

function normalizeBooking(booking) {
  return {
    id: booking.id,
    roomId: booking.roomId,
    clientName: booking.clientName,
    location: booking.location,
    botCount: booking.botCount,
    startDate: booking.startDate ? new Date(booking.startDate) : booking.startDate,
    endDate: booking.endDate ? new Date(booking.endDate) : booking.endDate,
    status: booking.status,
  };
}

function toCsv(rows) {
  const header = ['id', 'roomId', 'clientName', 'location', 'botCount', 'startDate', 'endDate', 'status'];
  const escapeValue = (value) => {
    const stringValue = value == null ? '' : String(value);
    return /[",\n]/.test(stringValue) ? `"${stringValue.replace(/"/g, '""')}"` : stringValue;
  };

  const rowLines = rows.map((row) => header.map((key) => escapeValue(row[key])).join(','));
  return [header.join(','), ...rowLines].join('\n');
}

async function createBooking(roomId, start, end, details = {}) {
  if (!prisma) {
    const fallbackBooking = {
      id: `memory-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      roomId,
      clientName: details.clientName || '',
      location: details.location || '',
      botCount: Number(details.botCount) || 0,
      startDate: start,
      endDate: end,
      status: 'PENDING_APPROVAL',
    };
    memoryBookings.push(fallbackBooking);
    return { success: true, data: fallbackBooking };
  }

  try {
    const booking = await prisma.booking.create({
      data: {
        roomId,
        clientName: details.clientName || '',
        location: details.location || '',
        botCount: Number(details.botCount) || 0,
        startDate: start,
        endDate: end,
        status: 'PENDING_APPROVAL',
      },
    });

    return { success: true, data: normalizeBooking(booking) };
  } catch (error) {
    console.warn('Database unavailable, using in-memory fallback for booking create', error.message || error);
    const fallbackBooking = {
      id: `memory-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      roomId,
      clientName: details.clientName || '',
      location: details.location || '',
      botCount: Number(details.botCount) || 0,
      startDate: start,
      endDate: end,
      status: 'PENDING_APPROVAL',
    };
    memoryBookings.push(fallbackBooking);
    return { success: true, data: fallbackBooking };
  }
}

async function getBookings() {
  if (!prisma) {
    return { success: true, data: memoryBookings.map(normalizeBooking) };
  }

  try {
    const bookings = await prisma.booking.findMany({ orderBy: { startDate: 'asc' } });
    return { success: true, data: bookings.map(normalizeBooking) };
  } catch (error) {
    console.warn('Database unavailable, using in-memory fallback for booking read', error.message || error);
    return { success: true, data: memoryBookings.map(normalizeBooking) };
  }
}

async function updateBookingDates(id, start, end) {
  if (!prisma) {
    const booking = memoryBookings.find((item) => item.id === id);
    if (!booking) {
      return { success: false, message: 'Booking not found.' };
    }

    booking.startDate = start;
    booking.endDate = end;
    return { success: true, data: booking };
  }

  try {
    const booking = await prisma.booking.update({
      where: { id },
      data: { startDate: start, endDate: end },
    });

    return { success: true, data: normalizeBooking(booking) };
  } catch (error) {
    console.warn('Database unavailable, using in-memory fallback for booking date update', error.message || error);
    const booking = memoryBookings.find((item) => item.id === id);
    if (!booking) {
      return { success: false, message: 'Booking not found.' };
    }

    booking.startDate = start;
    booking.endDate = end;
    return { success: true, data: booking };
  }
}

async function updateBookingDetails(id, details) {
  if (!prisma) {
    const booking = memoryBookings.find((item) => item.id === id);
    if (!booking) {
      return { success: false, message: 'Booking not found.' };
    }

    if (details.clientName !== undefined) booking.clientName = details.clientName;
    if (details.location !== undefined) booking.location = details.location;
    if (details.botCount !== undefined) booking.botCount = details.botCount;
    return { success: true, data: booking };
  }

  try {
    const booking = await prisma.booking.update({
      where: { id },
      data: {
        clientName: details.clientName,
        location: details.location,
        botCount: details.botCount,
      },
    });

    return { success: true, data: normalizeBooking(booking) };
  } catch (error) {
    console.warn('Database unavailable, using in-memory fallback for booking detail update', error.message || error);
    const booking = memoryBookings.find((item) => item.id === id);
    if (!booking) {
      return { success: false, message: 'Booking not found.' };
    }

    if (details.clientName !== undefined) booking.clientName = details.clientName;
    if (details.location !== undefined) booking.location = details.location;
    if (details.botCount !== undefined) booking.botCount = details.botCount;
    return { success: true, data: booking };
  }
}

async function exportBookings(format = 'json') {
  if (!prisma) {
    const normalized = memoryBookings.map((booking) => ({
      id: booking.id,
      roomId: booking.roomId,
      clientName: booking.clientName,
      location: booking.location,
      botCount: booking.botCount,
      startDate: new Date(booking.startDate).toISOString(),
      endDate: new Date(booking.endDate).toISOString(),
      status: booking.status,
    }));

    if (format === 'csv') {
      return toCsv(normalized);
    }

    return normalized;
  }

  try {
    const bookings = await prisma.booking.findMany({ orderBy: { startDate: 'asc' } });
    const normalized = bookings.map((booking) => ({
      id: booking.id,
      roomId: booking.roomId,
      clientName: booking.clientName,
      location: booking.location,
      botCount: booking.botCount,
      startDate: new Date(booking.startDate).toISOString(),
      endDate: new Date(booking.endDate).toISOString(),
      status: booking.status,
    }));

    if (format === 'csv') {
      return toCsv(normalized);
    }

    return normalized;
  } catch (error) {
    console.warn('Database unavailable, exporting in-memory fallback data', error.message || error);
    const normalized = memoryBookings.map((booking) => ({
      id: booking.id,
      roomId: booking.roomId,
      clientName: booking.clientName,
      location: booking.location,
      botCount: booking.botCount,
      startDate: new Date(booking.startDate).toISOString(),
      endDate: new Date(booking.endDate).toISOString(),
      status: booking.status,
    }));

    if (format === 'csv') {
      return toCsv(normalized);
    }

    return normalized;
  }
}

module.exports = {
  createBooking,
  getBookings,
  updateBookingDates,
  updateBookingDetails,
  exportBookings,
};
