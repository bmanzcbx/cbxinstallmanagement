import { addDays, differenceInDays, eachDayOfInterval } from 'date-fns';

export type GanttBar = {
  id: string;
  label: string;
  start: Date;
  end: Date;
  startOffset: number;
  width: number;
};

export function buildGanttBars(bookings: Array<{ id: string; clientName: string; location: string; startDate: string; endDate: string }>, rangeStart: Date, rangeEnd: Date): GanttBar[] {
  const normalizedStart = new Date(rangeStart);
  const normalizedEnd = new Date(rangeEnd);
  const totalDays = differenceInDays(normalizedEnd, normalizedStart) + 1;

  return bookings.map((booking) => {
    const start = new Date(booking.startDate);
    const end = new Date(booking.endDate);
    const startOffset = Math.max(0, differenceInDays(start, normalizedStart));
    const width = Math.max(1, differenceInDays(end, start) + 1);

    return {
      id: booking.id,
      label: `${booking.clientName || 'Client'} - ${booking.location || 'Location'}`,
      start,
      end,
      startOffset,
      width: Math.min(width, Math.max(1, totalDays - startOffset)),
    };
  });
}

export function getGanttRange(bookings: Array<{ startDate: string; endDate: string }>, fallbackStart: Date): { start: Date; end: Date } {
  if (!bookings.length) {
    return {
      start: addDays(new Date(fallbackStart), -7),
      end: addDays(new Date(fallbackStart), 14),
    };
  }

  const startDates = bookings.map((booking) => new Date(booking.startDate));
  const endDates = bookings.map((booking) => new Date(booking.endDate));

  return {
    start: new Date(Math.min(...startDates.map((date) => date.getTime()))),
    end: new Date(Math.max(...endDates.map((date) => date.getTime()))),
  };
}
