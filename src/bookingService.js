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

function parseCsv(csvText) {
  const text = String(csvText || '').trim();
  if (!text) {
    return [];
  }

  const rows = [];
  let current = '';
  let currentRow = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (character === '"' && inQuotes && nextCharacter === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (character === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (character === ',' && !inQuotes) {
      currentRow.push(current);
      current = '';
      continue;
    }

    if ((character === '\n' || character === '\r') && !inQuotes) {
      if (character === '\r' && nextCharacter === '\n') {
        continue;
      }

      currentRow.push(current);
      if (currentRow.some((value) => String(value).trim().length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      current = '';
      continue;
    }

    current += character;
  }

  if (current.length || currentRow.length) {
    currentRow.push(current);
    if (currentRow.some((value) => String(value).trim().length > 0)) {
      rows.push(currentRow);
    }
  }

  if (!rows.length) {
    return [];
  }

  const [header, ...dataRows] = rows;
  const normalizedHeader = header.map((column) => String(column || '').trim());

  return dataRows.map((columns) => {
    const row = {};
    normalizedHeader.forEach((key, position) => {
      row[key] = columns[position] ?? '';
    });
    return row;
  });
}

function normalizeImportedBooking(row) {
  const startDate = new Date(row.startDate || row.start || row.start_date);
  const endDate = new Date(row.endDate || row.end || row.end_date);

  return {
    roomId: String(row.roomId || row.room_id || row.room || 'imported-room').trim() || 'imported-room',
    clientName: String(row.clientName || row.client_name || row.name || '').trim(),
    location: String(row.location || row.site || row.address || '').trim(),
    botCount: Number(row.botCount || row.bot_count || row.count || 0) || 0,
    startDate,
    endDate,
    status: String(row.status || 'PENDING_APPROVAL').trim() || 'PENDING_APPROVAL',
  };
}

async function importBookingsFromCsv(csvText) {
  const records = parseCsv(csvText)
    .map(normalizeImportedBooking)
    .filter((record) => !Number.isNaN(record.startDate.getTime()) && !Number.isNaN(record.endDate.getTime()));

  if (!records.length) {
    return { success: false, message: 'No valid rows were found in the CSV file.' };
  }

  const created = [];
  for (const record of records) {
    const result = await createBooking(record.roomId, record.startDate, record.endDate, {
      clientName: record.clientName,
      location: record.location,
      botCount: record.botCount,
    });

    if (result?.success && result?.data) {
      created.push(result.data);
    }
  }

  return {
    success: true,
    data: created,
    imported: created.length,
    totalRows: records.length,
  };
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
  importBookingsFromCsv,
};
