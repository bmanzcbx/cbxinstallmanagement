import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type WheelEvent as ReactWheelEvent } from 'react';
import { DayPicker, type DateRange } from 'react-day-picker';
import type { DayButtonProps } from 'react-day-picker';
import { differenceInDays, eachDayOfInterval, format, isWithinInterval, addDays, startOfWeek, startOfMonth, endOfMonth, addMonths } from 'date-fns';
import 'react-day-picker/dist/style.css';
import { buildGanttBars, getGanttRange } from './ganttView';

type BookingResult = {
  success: boolean;
  message: string;
};

type DispatchResult = {
  success: boolean;
  bookingUrl?: string;
  territory?: string;
  assignedTeam?: {
    manager: string;
    technician: string;
  };
  message?: string;
};

type PageSetupSettings = {
  fontFamily: string;
  baseFontSize: string;
  pageBackground: string;
  panelBackground: string;
  panelBorder: string;
  primaryColor: string;
  secondaryColor: string;
  textColor: string;
  mutedTextColor: string;
  calendarSurface: string;
  calendarAccent: string;
  weekendShade: boolean;
  compactCells: boolean;
};

type BookingItem = {
  id: string;
  roomId: string;
  clientName: string;
  location: string;
  botCount: number;
  startDate: string;
  endDate: string;
  status: string;
};

type CohortPickerProps = {
  value?: DateRange;
  onChange?: (value: DateRange | undefined) => void;
  className?: string;
};

const DEFAULT_ACTIVE_INSTALLERS = ['Trevor', 'Praneeth'];
const DEFAULT_INACTIVE_INSTALLERS = ['3rd installer', '4th installer', '5th installer', '6th installer', '7th installer', '8th installer', '9th installer', '10th installer'];
const SESSION_STORAGE_KEY = 'cleanbotix-scheduler-session';
const DEFAULT_PAGE_SETUP: PageSetupSettings = {
  fontFamily: 'Merriweather, serif',
  baseFontSize: '16px',
  pageBackground: '#f8fafc',
  panelBackground: '#ffffff',
  panelBorder: '#cbd5e1',
  primaryColor: '#2563eb',
  secondaryColor: '#0f766e',
  textColor: '#0f172a',
  mutedTextColor: '#64748b',
  calendarSurface: '#f1f5f9',
  calendarAccent: '#38bdf8',
  weekendShade: true,
  compactCells: false,
};

type SessionSnapshot = {
  name?: string;
  bookings: BookingItem[];
  range?: { from?: string; to?: string };
  selectedBookingId: string | null;
  viewMode: 'calendar' | 'gantt' | 'capacity' | 'installers';
  installerAssignments: Record<string, string[]>;
  activeInstallers: string[];
  inactiveInstallers: string[];
  installerNames: Record<string, string>;
  peopleCapacityTarget: number;
  calendarMonth?: string;
  ganttScale: 'weekly' | 'monthly';
  timelineRange: 'next-2-weeks' | 'next-4-weeks' | 'next-3-months';
  ganttZoomLevel: number;
  ganttZoomLocked: boolean;
  expandedPerson: string | null;
  clientName: string;
  location: string;
  botCount: number;
  savedAt?: string;
};

const buildInstallerNameMap = (people: string[]) => people.reduce<Record<string, string>>((result, person) => {
  result[person] = person;
  return result;
}, {});

export function CohortPicker({ value, onChange, className }: CohortPickerProps) {
  const [range, setRange] = useState<DateRange | undefined>(value);
  const [result, setResult] = useState<BookingResult | null>(null);
  const [bookings, setBookings] = useState<BookingItem[]>([]);
  const [draggedBookingId, setDraggedBookingId] = useState<string | null>(null);
  const draggedBookingIdRef = useRef<string | null>(null);
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [resizeState, setResizeState] = useState<{ bookingId: string; startDate: Date; endDate: Date } | null>(null);
  const [resizePreviewEnd, setResizePreviewEnd] = useState<Date | null>(null);
  const [clientName, setClientName] = useState('');
  const [location, setLocation] = useState('');
  const [botCount, setBotCount] = useState(1);
  const [peopleCapacityTarget, setPeopleCapacityTarget] = useState(DEFAULT_ACTIVE_INSTALLERS.length);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [pendingRange, setPendingRange] = useState<DateRange | undefined>(undefined);
  const [activeBookingId, setActiveBookingId] = useState<string | null>(null);
  const [dragHoverDate, setDragHoverDate] = useState<string | null>(null);
  const [moveTargetDate, setMoveTargetDate] = useState<string | null>(null);
  const [revertingBookingId, setRevertingBookingId] = useState<string | null>(null);
  const [bookingOverlayRects, setBookingOverlayRects] = useState<Array<{ id: string; left: number; top: number; width: number; height: number; label: string; dayCount: number }>>([]);
  const [viewMode, setViewMode] = useState<'calendar' | 'gantt' | 'capacity' | 'installers'>('calendar');
  const [installerAssignments, setInstallerAssignments] = useState<Record<string, string[]>>({});
  const [calendarMonth, setCalendarMonth] = useState<Date | undefined>(undefined);
  const [ganttDragState, setGanttDragState] = useState<null | { bookingId: string; mode: 'move' | 'resize'; startX: number; initialStart: Date; initialEnd: Date }>(null);
  const [ganttPreviewStart, setGanttPreviewStart] = useState<Date | null>(null);
  const [ganttPreviewEnd, setGanttPreviewEnd] = useState<Date | null>(null);
  const [ganttScale, setGanttScale] = useState<'weekly' | 'monthly'>('weekly');
  const [timelineRange, setTimelineRange] = useState<'next-2-weeks' | 'next-4-weeks' | 'next-3-months'>('next-2-weeks');
  const [ganttZoomLevel, setGanttZoomLevel] = useState(1);
  const [ganttChartHovered, setGanttChartHovered] = useState(false);
  const [ganttZoomLocked, setGanttZoomLocked] = useState(false);
  const [ganttContextMenu, setGanttContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [expandedPerson, setExpandedPerson] = useState<string | null>(null);
  const [editingInstallerName, setEditingInstallerName] = useState<string | null>(null);
  const [installerNameDraft, setInstallerNameDraft] = useState('');
  const [newInstallerName, setNewInstallerName] = useState('');
  const [installerContextMenu, setInstallerContextMenu] = useState<{ person: string; x: number; y: number } | null>(null);
  const [showFileMenu, setShowFileMenu] = useState(false);
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [showAdminPrompt, setShowAdminPrompt] = useState(false);
  const [adminPasscodeInput, setAdminPasscodeInput] = useState('');
  const [isAdminMode, setIsAdminMode] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }

    return window.localStorage.getItem('cleanbotix-admin-mode') === 'true';
  });
  const [pageSetup, setPageSetup] = useState<PageSetupSettings>(() => {
    if (typeof window === 'undefined') {
      return DEFAULT_PAGE_SETUP;
    }

    try {
      const storedValue = window.localStorage.getItem('cleanbotix-page-setup');
      return storedValue ? JSON.parse(storedValue) as PageSetupSettings : DEFAULT_PAGE_SETUP;
    } catch (error) {
      console.error('Unable to load page setup', error);
      return DEFAULT_PAGE_SETUP;
    }
  });
  const [savedSessionLabel, setSavedSessionLabel] = useState<string | null>(null);
  const [saveAsName, setSaveAsName] = useState('');
  const [showSaveAsInput, setShowSaveAsInput] = useState(false);
  const [pendingBookingChange, setPendingBookingChange] = useState<null | {
    bookingId: string;
    mode: 'move' | 'resize';
    startDate: Date;
    endDate: Date;
    label: string;
  }>(null);
  const [dispatchZip, setDispatchZip] = useState('');
  const [dispatchProduct, setDispatchProduct] = useState('');
  const [isDispatching, setIsDispatching] = useState(false);
  const [dispatchResult, setDispatchResult] = useState<DispatchResult | null>(null);
  const calendarRef = useRef<HTMLDivElement | null>(null);
  const ganttTrackRef = useRef<HTMLDivElement | null>(null);
  const selectedBookingIdRef = useRef<string | null>(null);
  const dragStartPointRef = useRef<{ x: number; y: number } | null>(null);
  const interactionMovedRef = useRef(false);

  const getApiUrl = (path: string) => {
    return path;
  };

  const buildSessionSnapshot = (): SessionSnapshot => ({
    bookings,
    range: range ? { from: range.from?.toISOString(), to: range.to?.toISOString() } : undefined,
    selectedBookingId,
    viewMode,
    installerAssignments,
    activeInstallers,
    inactiveInstallers,
    installerNames,
    peopleCapacityTarget,
    calendarMonth: calendarMonth?.toISOString(),
    ganttScale,
    timelineRange,
    ganttZoomLevel,
    ganttZoomLocked,
    expandedPerson,
    clientName,
    location,
    botCount,
    savedAt: new Date().toISOString(),
  });

  const saveCurrentSession = (name?: string) => {
    const snapshot = buildSessionSnapshot();
    const nextName = name?.trim() || snapshot.name || 'Last saved session';
    const nextSnapshot = { ...snapshot, name: nextName };
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(nextSnapshot));
    setSavedSessionLabel(nextName + ' • ' + new Date(nextSnapshot.savedAt || Date.now()).toLocaleString());
    setShowFileMenu(false);
    setShowSaveAsInput(false);
    setSaveAsName('');
    setResult({ success: true, message: `Session saved as ${nextName}.` });
  };

  const clearSavedSession = () => {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    setSavedSessionLabel(null);
    setShowFileMenu(false);
    setShowSaveAsInput(false);
    setSaveAsName('');
    setResult({ success: true, message: 'Saved session data cleared.' });
  };

  const openAdminSetup = () => {
    if (isAdminMode) {
      setShowSetupModal(true);
      setShowFileMenu(false);
      return;
    }

    setAdminPasscodeInput('');
    setShowAdminPrompt(true);
    setShowFileMenu(false);
  };

  const submitAdminSetup = () => {
    if (adminPasscodeInput.trim().toLowerCase() === 'admin') {
      setIsAdminMode(true);
      window.localStorage.setItem('cleanbotix-admin-mode', 'true');
      setShowAdminPrompt(false);
      setShowSetupModal(true);
      setResult({ success: true, message: 'Admin setup unlocked.' });
      return;
    }

    setResult({ success: false, message: 'Invalid admin passcode.' });
  };

  const resetPageSetup = () => {
    setPageSetup(DEFAULT_PAGE_SETUP);
    setResult({ success: true, message: 'Page setup reset to defaults.' });
  };

  const restoreLastSession = () => {
    try {
      const storedValue = localStorage.getItem(SESSION_STORAGE_KEY);
      if (!storedValue) {
        setResult({ success: false, message: 'No saved session found.' });
        return;
      }

      const snapshot = JSON.parse(storedValue) as SessionSnapshot;
      setBookings(snapshot.bookings || []);
      setRange(snapshot.range ? { from: snapshot.range.from ? new Date(snapshot.range.from) : undefined, to: snapshot.range.to ? new Date(snapshot.range.to) : undefined } : undefined);
      setSelectedBookingId(snapshot.selectedBookingId ?? null);
      setViewMode(snapshot.viewMode || 'calendar');
      setInstallerAssignments(snapshot.installerAssignments || {});
      setActiveInstallers(snapshot.activeInstallers || DEFAULT_ACTIVE_INSTALLERS);
      setInactiveInstallers(snapshot.inactiveInstallers || DEFAULT_INACTIVE_INSTALLERS);
      setInstallerNames(snapshot.installerNames || ({ ...buildInstallerNameMap(DEFAULT_ACTIVE_INSTALLERS), ...buildInstallerNameMap(DEFAULT_INACTIVE_INSTALLERS) }));
      setPeopleCapacityTarget(snapshot.peopleCapacityTarget || DEFAULT_ACTIVE_INSTALLERS.length);
      setCalendarMonth(snapshot.calendarMonth ? new Date(snapshot.calendarMonth) : undefined);
      setGanttScale(snapshot.ganttScale || 'weekly');
      setTimelineRange(snapshot.timelineRange || 'next-2-weeks');
      setGanttZoomLevel(snapshot.ganttZoomLevel || 1);
      setGanttZoomLocked(Boolean(snapshot.ganttZoomLocked));
      setExpandedPerson(snapshot.expandedPerson ?? null);
      setClientName(snapshot.clientName || '');
      setLocation(snapshot.location || '');
      setBotCount(snapshot.botCount || 1);
      setSavedSessionLabel(snapshot.name ? `${snapshot.name} • ${new Date(snapshot.savedAt || Date.now()).toLocaleString()}` : (snapshot.savedAt ? new Date(snapshot.savedAt).toLocaleString() : null));
      setShowFileMenu(false);
      setResult({ success: true, message: 'Last saved session restored.' });
    } catch (error) {
      console.error('Unable to restore saved session', error);
      setResult({ success: false, message: 'Unable to restore the saved session.' });
    }
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('cleanbotix-page-setup', JSON.stringify(pageSetup));
    }
  }, [pageSetup]);

  const readJsonResponse = async (response: Response) => {
    const text = await response.text();
    if (!text) {
      return null;
    }

    try {
      return JSON.parse(text);
    } catch (error) {
      console.error('Unable to parse response JSON', error);
      return null;
    }
  };

  const normalizeDay = (value: Date) => {
    const normalized = new Date(value);
    normalized.setHours(0, 0, 0, 0);
    return normalized;
  };

  const sameDay = (left: Date, right: Date) => normalizeDay(left).getTime() === normalizeDay(right).getTime();

  useEffect(() => {
    const loadBookings = async () => {
      try {
        const response = await fetch(getApiUrl('/api/bookings'));
        if (!response.ok) {
          throw new Error(`Booking request failed with status ${response.status}`);
        }

        const data = await readJsonResponse(response);
        if (data?.success && Array.isArray(data.data)) {
          setBookings(data.data || []);
          return;
        }
      } catch (error) {
        console.error('Unable to load bookings', error);
      }

      setBookings([]);
    };

    loadBookings();
  }, []);

  useEffect(() => {
    selectedBookingIdRef.current = selectedBookingId;
  }, [selectedBookingId]);

  useEffect(() => {
    if (!draggedBookingId) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      const dayButton = target?.closest('[data-day-date]') as HTMLElement | null;
      const dayValue = dayButton?.getAttribute('data-day-date');

      if (dragStartPointRef.current) {
        const movedDistance = Math.hypot(event.clientX - dragStartPointRef.current.x, event.clientY - dragStartPointRef.current.y);
        if (movedDistance > 4) {
          interactionMovedRef.current = true;
        }
      }

      setDragHoverDate(dayValue ?? null);
    };

    const handleMouseUp = async (event: MouseEvent) => {
      const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      const dayButton = target?.closest('[data-day-date]') as HTMLElement | null;
      const dayValue = dayButton?.getAttribute('data-day-date');
      const activeBookingId = draggedBookingIdRef.current;

      if (activeBookingId && dayValue && interactionMovedRef.current) {
        const booking = bookings.find((item) => item.id === activeBookingId);
        if (booking) {
          const currentStart = normalizeDay(new Date(booking.startDate));
          const currentEnd = normalizeDay(new Date(booking.endDate));
          const targetDay = normalizeDay(new Date(dayValue));
          const offset = differenceInDays(targetDay, currentStart);
          const nextStart = addDays(currentStart, offset);
          const nextEnd = addDays(currentEnd, offset);
          setPendingBookingChange({
            bookingId: booking.id,
            mode: 'move',
            startDate: nextStart,
            endDate: nextEnd,
            label: `Move booking to ${format(nextStart, 'MMM d')} through ${format(nextEnd, 'MMM d')}?`,
          });
          selectedBookingIdRef.current = null;
          setSelectedBookingId(null);
        }
      }

      dragStartPointRef.current = null;
      interactionMovedRef.current = false;
      draggedBookingIdRef.current = null;
      setDraggedBookingId(null);
      setDragHoverDate(null);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.body.style.webkitUserSelect = '';
      window.getSelection()?.removeAllRanges();
    };

    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
    document.body.style.webkitUserSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.body.style.webkitUserSelect = '';
    };
  }, [draggedBookingId, bookings]);

  useEffect(() => {
    if (!resizeState) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      const dayButton = target?.closest('[data-day-date]') as HTMLElement | null;
      const dayValue = dayButton?.getAttribute('data-day-date');

      if (!dayValue) {
        setResizePreviewEnd(null);
        return;
      }

      const nextDate = normalizeDay(new Date(dayValue));
      const bookingStart = normalizeDay(new Date(bookings.find((item) => item.id === resizeState.bookingId)?.startDate ?? resizeState.startDate));

      if (nextDate < bookingStart) {
        setResizePreviewEnd(bookingStart);
        return;
      }

      setResizePreviewEnd(nextDate);
    };

    const handleMouseUp = async (event: MouseEvent) => {
      const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      const dayButton = target?.closest('[data-day-date]') as HTMLElement | null;
      const dayValue = dayButton?.getAttribute('data-day-date');
      const booking = bookings.find((item) => item.id === resizeState.bookingId);

      if (!booking || !dayValue) {
        selectedBookingIdRef.current = null;
        setSelectedBookingId(null);
        setResizeState(null);
        setResizePreviewEnd(null);
        return;
      }

      const bookingStart = normalizeDay(new Date(booking.startDate));
      const proposedEnd = normalizeDay(new Date(dayValue));
      const safeEnd = proposedEnd < bookingStart ? bookingStart : proposedEnd;
      const newEnd = addDays(bookingStart, differenceInDays(safeEnd, bookingStart));
      setPendingBookingChange({
        bookingId: booking.id,
        mode: 'resize',
        startDate: bookingStart,
        endDate: newEnd,
        label: `Resize booking to end on ${format(newEnd, 'MMM d')}?`,
      });
      selectedBookingIdRef.current = null;
      setSelectedBookingId(null);
      setResizeState(null);
      setResizePreviewEnd(null);
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.body.style.webkitUserSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.body.style.webkitUserSelect = '';
    };
  }, [resizeState, bookings]);

  const bookedRanges = useMemo(
    () =>
      bookings.map((booking) => ({
        start: new Date(booking.startDate),
        end: new Date(booking.endDate),
      })),
    [bookings]
  );

  const bookedModifier = useMemo(
    () => ({
      booked: (date: Date) =>
        bookings.some((booking) => {
          const start = new Date(booking.startDate);
          const end = new Date(booking.endDate);
          return date >= start && date <= end;
        }),
    }),
    [bookings]
  );

  const plannedCapacity = useMemo(() => bookings.reduce((total, booking) => total + Math.max(1, booking.botCount || 1), 0), [bookings]);
  const remainingCapacity = Math.max(0, peopleCapacityTarget - plannedCapacity);

  const summary = useMemo(() => {
    const capacitySummary = `${plannedCapacity} assigned • ${remainingCapacity} remaining`;
    if (!range?.from) return capacitySummary;
    const from = format(range.from, 'PPP');
    const to = range.to ? format(range.to, 'PPP') : '...';
    return range.to ? `${capacitySummary} • ${from} → ${to}` : `${capacitySummary} • ${from} → Select end date`;
  }, [range, plannedCapacity, remainingCapacity]);

  const [activeInstallers, setActiveInstallers] = useState<string[]>(DEFAULT_ACTIVE_INSTALLERS);
  const [inactiveInstallers, setInactiveInstallers] = useState<string[]>(DEFAULT_INACTIVE_INSTALLERS);
  const [installerNames, setInstallerNames] = useState<Record<string, string>>(() => ({
    ...buildInstallerNameMap(DEFAULT_ACTIVE_INSTALLERS),
    ...buildInstallerNameMap(DEFAULT_INACTIVE_INSTALLERS),
  }));
  const visiblePeople = useMemo(() => {
    const requested = Math.max(1, Math.min(peopleCapacityTarget, activeInstallers.length));
    return activeInstallers.slice(0, requested);
  }, [peopleCapacityTarget, activeInstallers]);

  useEffect(() => {
    const target = Math.max(1, Math.min(peopleCapacityTarget, activeInstallers.length + inactiveInstallers.length));
    const nextActive = [...activeInstallers];
    const nextInactive = [...inactiveInstallers];

    if (target > nextActive.length) {
      const needed = target - nextActive.length;
      for (let index = 0; index < needed; index += 1) {
        const nextPerson = nextInactive.shift();
        if (!nextPerson) {
          break;
        }
        nextActive.push(nextPerson);
      }
    } else if (target < nextActive.length) {
      const excess = nextActive.slice(target);
      const trimmedActive = nextActive.slice(0, target);
      nextInactive.unshift(...excess);
      if (trimmedActive.join('|') !== nextActive.join('|') || nextInactive.length !== inactiveInstallers.length + excess.length) {
        setActiveInstallers(trimmedActive);
        setInactiveInstallers(nextInactive);
      }
      return;
    }

    if (nextActive.join('|') !== activeInstallers.join('|') || nextInactive.join('|') !== inactiveInstallers.join('|')) {
      setActiveInstallers(nextActive);
      setInactiveInstallers(nextInactive);
    }
  }, [activeInstallers, inactiveInstallers, peopleCapacityTarget]);

  const addInstallerToRoster = (rawName: string) => {
    const trimmed = rawName.trim();
    if (!trimmed) {
      return;
    }

    const normalizedName = trimmed;
    const allInstallers = [...activeInstallers, ...inactiveInstallers];
    const alreadyExists = allInstallers.some((person) => person.toLowerCase() === normalizedName.toLowerCase());
    if (!alreadyExists) {
      setInactiveInstallers((current) => [...current, normalizedName]);
    }

    setInstallerNames((current) => ({ ...current, [normalizedName]: normalizedName }));
    setNewInstallerName('');
  };

  const toggleInstallerActive = (person: string) => {
    const isActive = activeInstallers.includes(person);
    if (isActive) {
      setActiveInstallers((current) => current.filter((entry) => entry !== person));
      setInactiveInstallers((current) => [...current, person]);
      return;
    }

    setInactiveInstallers((current) => current.filter((entry) => entry !== person));
    setActiveInstallers((current) => {
      const next = [...current, person];
      setPeopleCapacityTarget((target) => Math.max(target, next.length));
      return next;
    });
  };

  const openInstallerContextMenu = (event: ReactMouseEvent<HTMLElement>, person: string) => {
    event.preventDefault();
    event.stopPropagation();
    setInstallerContextMenu({ person, x: event.clientX, y: event.clientY });
  };

  const startEditingInstallerName = (person: string) => {
    setEditingInstallerName(person);
    setInstallerNameDraft(installerNames[person] || person);
    setInstallerContextMenu(null);
  };

  const zoomGanttChart = (direction: 'in' | 'out') => {
    setGanttZoomLevel((current) => Math.max(0.55, Math.min(2.2, current + (direction === 'in' ? -0.1 : 0.1))));
    setGanttZoomLocked(true);
  };

  const handleGanttWheelZoom = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!ganttChartHovered || event.ctrlKey || !ganttZoomLocked) {
      return;
    }

    if (Math.abs(event.deltaY) === 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setGanttZoomLevel((current) => Math.max(0.55, Math.min(2.2, current + (event.deltaY < 0 ? -0.1 : 0.1))));
  };

  const handleGanttContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!ganttDragState) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setGanttDragState(null);
    setGanttPreviewStart(null);
    setGanttPreviewEnd(null);
    setGanttContextMenu({ x: event.clientX, y: event.clientY });
  };

  const revertGanttMove = () => {
    setGanttDragState(null);
    setGanttPreviewStart(null);
    setGanttPreviewEnd(null);
    setGanttContextMenu(null);
    setResult({ success: false, message: 'Move reverted.' });
  };

  const revertGanttMoveToOriginal = async () => {
    if (!ganttDragState) {
      return;
    }

    const booking = bookings.find((item) => item.id === ganttDragState.bookingId);
    if (!booking) {
      revertGanttMove();
      return;
    }

    setGanttContextMenu(null);
    setGanttDragState(null);
    setGanttPreviewStart(null);
    setGanttPreviewEnd(null);

    try {
      const response = await fetch(getApiUrl(`/api/bookings/${booking.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start: new Date(booking.startDate).toISOString(), end: new Date(booking.endDate).toISOString() }),
      });

      const data = await response.json();
      if (response.ok && data.success) {
        await loadBookings();
        setResult({ success: true, message: 'Returned to original booking dates.' });
      } else {
        setResult({ success: false, message: data.message || 'Unable to restore the original booking dates.' });
      }
    } catch (error) {
      setResult({ success: false, message: 'Unable to reach the booking service.' });
    }
  };

  const getAssignmentKey = (booking: Pick<BookingItem, 'id' | 'clientName' | 'location'>) => booking.id || `${booking.clientName || 'Client'}::${booking.location || 'Location'}`;

  const getBookingColor = (booking: BookingItem) => {
    const seed = `${booking.clientName}::${booking.location}`;
    let hash = 0;
    for (let index = 0; index < seed.length; index += 1) {
      hash = (hash << 5) - hash + seed.charCodeAt(index);
    }
    const palette = ['#2563eb', '#0f766e', '#7c3aed', '#dc2626', '#ea580c', '#0891b2', '#84cc16', '#db2777'];
    return palette[Math.abs(hash) % palette.length];
  };

  const capacityAssignments = useMemo(() => {
    const grouped = bookings.reduce<Record<string, { key: string; bookingId: string; clientName: string; location: string; startDate: string; endDate: string; assignedPerson: string; peopleNeeded: number }>>((result, booking) => {
      const key = getAssignmentKey(booking);
      if (!result[key]) {
        const assignedPerson = Object.entries(installerAssignments).find(([, assignmentKeys]) => assignmentKeys.includes(booking.id))?.[0] || '';
        result[key] = {
          key,
          bookingId: booking.id,
          clientName: booking.clientName || 'Client',
          location: booking.location || 'Location',
          startDate: booking.startDate,
          endDate: booking.endDate,
          assignedPerson,
          peopleNeeded: 1,
        };
      }
      return result;
    }, {});

    return Object.values(grouped).sort((left, right) => `${left.clientName}-${left.location}`.localeCompare(`${right.clientName}-${right.location}`));
  }, [bookings, installerAssignments]);

  const visibleAssignmentIds = useMemo(() => {
    const next = new Set<string>();
    Object.values(installerAssignments).forEach((assignmentIds) => {
      assignmentIds.forEach((bookingId) => next.add(bookingId));
    });
    return next;
  }, [installerAssignments]);

  const officeHoursPerDay = 8;
  const assignmentHoursPerDay = 12;
  const travelHoursPerDay = 8;
  const weeklyOfficeHours = 40;
  const weeklyAssignmentHours = 60;
  const travelHoursPerAssignment = 32;
  const monthlyOfficeHours = 160;
  const monthlyCapacityHours = 160;
  const healthyThresholdHours = 120;
  const nearCapacityThresholdHours = 160;
  const overloadThresholdHours = 161;
  const criticalThresholdHours = 180;

  const getCapacityBand = (hours: number) => {
    const bandStart = Math.max(101, Math.floor((hours - 1) / 10) * 10 + 1);
    const bandEnd = bandStart + 9;
    const status = hours >= criticalThresholdHours
      ? 'Critical overload'
      : hours >= overloadThresholdHours
        ? 'Overbooked'
        : hours >= nearCapacityThresholdHours
          ? 'Near capacity'
          : 'Healthy';

    return { bandStart, bandEnd, status };
  };

  const countCalendarDays = (startDate: Date, endDate: Date) => {
    const normalizedStart = normalizeDay(new Date(startDate));
    const normalizedEnd = normalizeDay(new Date(endDate));
    let count = 0;
    const cursor = new Date(normalizedStart);

    while (cursor <= normalizedEnd) {
      count += 1;
      cursor.setDate(cursor.getDate() + 1);
    }

    return count;
  };

  const calculateMonthlyWorkloadBreakdown = (assignments: Array<{ startDate: string; endDate: string }>) => {
    const monthBuckets = new Map<string, { month: string; assignmentCount: number; officeHours: number; assignmentHours: number; travelHours: number; totalHours: number }>();

    assignments.forEach((assignment) => {
      const normalizedStart = new Date(assignment.startDate);
      const normalizedEnd = new Date(assignment.endDate);
      const monthStarts: Date[] = [];
      const cursor = startOfMonth(normalizedStart);
      const finalMonth = startOfMonth(normalizedEnd);

      while (cursor <= finalMonth) {
        monthStarts.push(new Date(cursor));
        cursor.setMonth(cursor.getMonth() + 1);
      }

      monthStarts.forEach((monthStart) => {
        const monthKey = format(monthStart, 'MMM yyyy');
        const existing = monthBuckets.get(monthKey) || {
          month: monthKey,
          assignmentCount: 0,
          officeHours: monthlyOfficeHours,
          assignmentHours: 0,
          travelHours: 0,
          totalHours: monthlyOfficeHours,
        };

        existing.assignmentCount += 1;
        existing.assignmentHours = existing.assignmentCount * weeklyAssignmentHours;
        existing.travelHours = existing.assignmentCount * travelHoursPerAssignment;
        existing.officeHours = Math.max(0, monthlyOfficeHours - (existing.assignmentCount * weeklyOfficeHours));
        existing.totalHours = existing.officeHours + existing.assignmentHours + existing.travelHours;

        monthBuckets.set(monthKey, existing);
      });
    });

    return Array.from(monthBuckets.values()).sort((left, right) => left.month.localeCompare(right.month));
  };

  const workloadRows = useMemo(() => {
    return visiblePeople.map((person) => {
      const assignments = capacityAssignments.filter((assignment) => assignment.assignedPerson === person);

      const workloadItems = assignments.map((assignment) => {
        const startDate = new Date(assignment.startDate);
        const endDate = new Date(assignment.endDate);
        const assignmentDays = Math.max(1, differenceInDays(endDate, startDate) + 1);
        const travelDays = countCalendarDays(addDays(new Date(startDate), -2), addDays(new Date(startDate), -1)) + countCalendarDays(addDays(new Date(endDate), 1), addDays(new Date(endDate), 2));

        return {
          bookingId: assignment.bookingId,
          clientName: assignment.clientName,
          location: assignment.location,
          assignmentDays,
          travelDays,
          workloadHours: 0,
          workloadDays: 0,
        };
      });

      const monthlyBreakdown = calculateMonthlyWorkloadBreakdown(assignments);
      const totalWorkloadHours = monthlyBreakdown.reduce((total, item) => total + item.totalHours, 0);
      const totalWorkloadDays = totalWorkloadHours / officeHoursPerDay;
      const status = totalWorkloadHours >= criticalThresholdHours
        ? 'Critical overload'
        : totalWorkloadHours >= overloadThresholdHours
          ? 'Overloaded'
          : totalWorkloadHours >= nearCapacityThresholdHours
            ? 'Near capacity'
            : 'Healthy';
      const staffingNeed = Math.max(1, Math.ceil(totalWorkloadHours / monthlyCapacityHours));

      return {
        person,
        assignments: workloadItems,
        totalWorkloadHours,
        totalWorkloadDays,
        status,
        staffingNeed,
        monthlyBreakdown,
      };
    });
  }, [visiblePeople, capacityAssignments]);

  const staffingSummary = useMemo(() => {
    const totalWorkloadHours = workloadRows.reduce((total, row) => total + row.totalWorkloadHours, 0);
    const totalAssignments = workloadRows.reduce((total, row) => total + row.assignments.length, 0);
    const availableStaff = workloadRows.length;
    const recommendedStaff = Math.max(1, Math.ceil(totalWorkloadHours / monthlyCapacityHours));
    const staffGap = Math.max(0, recommendedStaff - availableStaff);

    return {
      totalWorkloadHours,
      totalAssignments,
      availableStaff,
      recommendedStaff,
      staffGap,
      isUnderstaffed: recommendedStaff > availableStaff,
    };
  }, [workloadRows]);

  const visibleGanttBookings = useMemo(() => {
    if (visibleAssignmentIds.size === 0) {
      return bookings;
    }
    return bookings.filter((booking) => visibleAssignmentIds.has(booking.id));
  }, [bookings, visibleAssignmentIds]);

  const saveInstallerName = (person: string) => {
    const trimmed = installerNameDraft.trim();
    if (!trimmed) {
      setInstallerNameDraft(installerNames[person] || person);
      setEditingInstallerName(null);
      return;
    }

    setInstallerNames((current) => ({ ...current, [person]: trimmed }));
    setEditingInstallerName(null);
    setInstallerNameDraft('');
  };

  const personAssignmentRows = useMemo(() => {
    return visiblePeople
      .map((person) => {
        const assignmentIds = installerAssignments[person] || [];
        const assignments = assignmentIds
          .map((bookingId) => {
            const booking = bookings.find((item) => item.id === bookingId);
            const assignment = capacityAssignments.find((item) => item.bookingId === bookingId);
            if (!booking) {
              return null;
            }
            return {
              bookingId,
              booking,
              clientName: assignment?.clientName || booking.clientName || 'Assignment',
              location: assignment?.location || booking.location || 'Location',
              startDate: assignment?.startDate || booking.startDate,
              endDate: assignment?.endDate || booking.endDate,
            };
          })
          .filter((value): value is NonNullable<typeof value> => Boolean(value));

        return { person, assignments };
      })
      .filter((row) => row.assignments.length > 0);
  }, [visiblePeople, installerAssignments, bookings, capacityAssignments]);

  const bookingLegend = useMemo(() => {
    const uniqueBookings = visibleGanttBookings.filter((booking, index, list) => {
      const firstIndex = list.findIndex((entry) => `${entry.clientName}-${entry.location}` === `${booking.clientName}-${booking.location}`);
      return firstIndex === index;
    });

    return uniqueBookings.map((booking) => ({
      ...booking,
      color: getBookingColor(booking),
    }));
  }, [visibleGanttBookings]);

  const ganttRange = useMemo(() => {
    const baseRange = getGanttRange(visibleGanttBookings, new Date());
    const baseStart = new Date(baseRange.start);
    const baseEnd = new Date(baseRange.end);
    const center = new Date((baseStart.getTime() + baseEnd.getTime()) / 2);
    const presetDays = timelineRange === 'next-4-weeks' ? 28 : timelineRange === 'next-3-months' ? 90 : 14;
    const visibleDays = Math.max(7, Math.round(presetDays * ganttZoomLevel));
    const halfSpan = Math.max(3, Math.floor(visibleDays / 2));

    return {
      start: addDays(center, -halfSpan),
      end: addDays(center, halfSpan),
    };
  }, [visibleGanttBookings, timelineRange, ganttZoomLevel]);
  const ganttBars = useMemo(() => buildGanttBars(visibleGanttBookings, ganttRange.start, ganttRange.end), [visibleGanttBookings, ganttRange]);
  const timelineBuckets = useMemo(() => {
    const buckets: Array<{ key: string; start: Date; end: Date; label: string; detail: string; shortLabel: string }> = [];
    let cursor = new Date(ganttRange.start);

    if (ganttScale === 'weekly') {
      while (cursor <= ganttRange.end) {
        const weekStart = startOfWeek(cursor, { weekStartsOn: 0 });
        const weekEnd = addDays(weekStart, 6);
        buckets.push({
          key: `${weekStart.toISOString()}-${weekEnd.toISOString()}`,
          start: weekStart,
          end: weekEnd,
          label: format(weekStart, 'MMM d'),
          detail: `${format(weekStart, 'MMM d')} – ${format(weekEnd, 'MMM d')}`,
          shortLabel: format(weekStart, 'MMM d'),
        });
        cursor = addDays(weekEnd, 1);
      }
    } else {
      while (cursor <= ganttRange.end) {
        const monthStart = startOfMonth(cursor);
        const monthEnd = endOfMonth(cursor);
        buckets.push({
          key: `${monthStart.toISOString()}-${monthEnd.toISOString()}`,
          start: monthStart,
          end: monthEnd,
          label: format(monthStart, 'MMM'),
          detail: format(monthStart, 'yyyy'),
          shortLabel: format(monthStart, 'MMM yyyy'),
        });
        cursor = addMonths(monthStart, 1);
      }
    }

    return buckets;
  }, [ganttRange, ganttScale]);

  const loadBookings = async () => {
    try {
      const response = await fetch(getApiUrl('/api/bookings'));
      const data = await response.json();
      if (data.success && Array.isArray(data.data)) {
        setBookings(data.data || []);
      }
    } catch (error) {
      console.error('Unable to load bookings', error);
    }
  };

  const handleGanttTrackClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!timelineBuckets.length) {
      return;
    }

    const track = event.currentTarget;
    const rect = track.getBoundingClientRect();
    const relativeX = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
    const ratio = rect.width > 0 ? relativeX / rect.width : 0;
    const bucketIndex = Math.min(Math.max(Math.floor(ratio * timelineBuckets.length), 0), timelineBuckets.length - 1);
    const bucket = timelineBuckets[bucketIndex];

    const nextRange = { from: bucket.start, to: bucket.end };
    setRange(nextRange);
    onChange?.(nextRange);
    openDetailsModal(nextRange);
  };

  const moveBookingToStart = async (bookingId: string, nextStart: Date) => {
    const booking = bookings.find((item) => item.id === bookingId);
    if (!booking) return;

    const duration = differenceInDays(new Date(booking.endDate), new Date(booking.startDate));
    const nextEnd = addDays(nextStart, duration);

    try {
      const response = await fetch(getApiUrl(`/api/bookings/${bookingId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start: nextStart.toISOString(), end: nextEnd.toISOString() }),
      });

      const data = await response.json();
      if (response.ok && data.success) {
        await loadBookings();
        setResult({ success: true, message: 'Booking moved successfully.' });
      } else {
        setResult({ success: false, message: data.message || 'Unable to move booking.' });
      }
    } catch (error) {
      setResult({ success: false, message: 'Unable to reach the booking service.' });
    }
  };

  const resizeBookingToEnd = async (bookingId: string, nextEnd: Date) => {
    const booking = bookings.find((item) => item.id === bookingId);
    if (!booking) return;

    try {
      const response = await fetch(getApiUrl(`/api/bookings/${bookingId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start: new Date(booking.startDate).toISOString(), end: nextEnd.toISOString() }),
      });

      const data = await response.json();
      if (response.ok && data.success) {
        await loadBookings();
        setResult({ success: true, message: 'Booking resized successfully.' });
      } else {
        setResult({ success: false, message: data.message || 'Unable to resize booking.' });
      }
    } catch (error) {
      setResult({ success: false, message: 'Unable to reach the booking service.' });
    }
  };

  const getBookingForDate = (date: Date) => {
    const normalizedDate = normalizeDay(date);

    return bookings.find((booking) => {
      const start = normalizeDay(new Date(booking.startDate));
      const end = normalizeDay(new Date(booking.endDate));
      return normalizedDate >= start && normalizedDate <= end;
    });
  };

  const handleDrop = async (day: Date, bookingId: string | null) => {
    if (!bookingId) return;

    const booking = bookings.find((item) => item.id === bookingId);
    if (!booking) return;

    const currentStart = normalizeDay(new Date(booking.startDate));
    const currentEnd = normalizeDay(new Date(booking.endDate));
    const targetDay = normalizeDay(day);
    const offset = differenceInDays(targetDay, currentStart);
    const newStart = addDays(currentStart, offset);
    const newEnd = addDays(currentEnd, offset);

    if (newStart < new Date('1900-01-01')) {
      setResult({ success: false, message: 'That move would go before the allowed range.' });
      setDraggedBookingId(null);
      return;
    }

    setPendingBookingChange({
      bookingId: booking.id,
      mode: 'move',
      startDate: newStart,
      endDate: newEnd,
      label: `Move booking to ${format(newStart, 'MMM d')} through ${format(newEnd, 'MMM d')}?`,
    });
    selectedBookingIdRef.current = null;
    setSelectedBookingId(null);
    setDraggedBookingId(null);
    setDragHoverDate(null);
  };

  const handleConfirmBookingChange = async () => {
    if (!pendingBookingChange) return;

    const booking = bookings.find((item) => item.id === pendingBookingChange.bookingId);
    if (!booking) {
      setPendingBookingChange(null);
      return;
    }

    try {
      const response = await fetch(getApiUrl(`/api/bookings/${booking.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start: pendingBookingChange.startDate.toISOString(),
          end: pendingBookingChange.endDate.toISOString(),
        }),
      });

      const data = await readJsonResponse(response);
      if (response.ok && data?.success) {
        await loadBookings();
        setResult({ success: true, message: pendingBookingChange.mode === 'move' ? 'Booking moved successfully.' : 'Booking resized successfully.' });
      } else {
        setResult({ success: false, message: data?.message || 'Unable to update booking.' });
      }
    } catch (error) {
      setResult({ success: false, message: 'Unable to reach the booking service.' });
    } finally {
      selectedBookingIdRef.current = null;
      setSelectedBookingId(null);
      draggedBookingIdRef.current = null;
      setDraggedBookingId(null);
      setDragHoverDate(null);
      setResizeState(null);
      setResizePreviewEnd(null);
      setPendingBookingChange(null);
      setRevertingBookingId(booking.id);
      window.setTimeout(() => setRevertingBookingId(null), 400);
    }
  };

  const handleCancelBookingChange = () => {
    selectedBookingIdRef.current = null;
    setSelectedBookingId(null);
    draggedBookingIdRef.current = null;
    setDraggedBookingId(null);
    setDragHoverDate(null);
    setResizeState(null);
    setResizePreviewEnd(null);
    setPendingBookingChange(null);
    setResult({ success: true, message: 'Booking change cancelled.' });
  };

  const generateDispatchLink = async () => {
    setIsDispatching(true);
    setDispatchResult(null);

    try {
      const response = await fetch(getApiUrl('/api/dispatch/route-setup'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zip: dispatchZip, product: dispatchProduct }),
      });

      const payload = await readJsonResponse(response);
      if (!response.ok || !payload?.success || !payload?.bookingUrl) {
        const message = payload?.message || 'Dispatch routing failed.';
        setDispatchResult({ success: false, message });
        setResult({ success: false, message });
        return;
      }

      const nextResult: DispatchResult = {
        success: true,
        bookingUrl: payload.bookingUrl,
        territory: payload.territory,
        assignedTeam: payload.assignedTeam,
      };

      setDispatchResult(nextResult);
      setResult({ success: true, message: 'Intelligent setup link generated.' });
    } catch (error) {
      const message = 'Unable to reach dispatch routing service.';
      setDispatchResult({ success: false, message });
      setResult({ success: false, message });
    } finally {
      setIsDispatching(false);
    }
  };

  useEffect(() => {
    const handleGlobalWheel = (event: WheelEvent) => {
      if (!ganttChartHovered || event.ctrlKey || !ganttZoomLocked) {
        return;
      }

      if (Math.abs(event.deltaY) === 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setGanttZoomLevel((current) => Math.max(0.55, Math.min(2.2, current + (event.deltaY < 0 ? -0.1 : 0.1))));
    };

    window.addEventListener('wheel', handleGlobalWheel, { passive: false });

    return () => {
      window.removeEventListener('wheel', handleGlobalWheel);
    };
  }, [ganttChartHovered, ganttZoomLocked]);

  useEffect(() => {
    if (!ganttDragState) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const track = ganttTrackRef.current;
      if (!track) return;

      const rect = track.getBoundingClientRect();
      const totalVisibleDays = Math.max(1, differenceInDays(ganttRange.end, ganttRange.start) + 1);
      const pixelsPerDay = rect.width / totalVisibleDays;
      const deltaPixels = event.clientX - ganttDragState.startX;
      const deltaDays = Math.round(deltaPixels / Math.max(1, pixelsPerDay));

      if (ganttDragState.mode === 'move') {
        const nextStart = addDays(ganttDragState.initialStart, deltaDays);
        setGanttPreviewStart(nextStart);
        setGanttPreviewEnd(addDays(nextStart, differenceInDays(ganttDragState.initialEnd, ganttDragState.initialStart)));
      } else {
        const nextEnd = addDays(ganttDragState.initialStart, Math.max(1, differenceInDays(ganttDragState.initialEnd, ganttDragState.initialStart) + deltaDays));
        setGanttPreviewEnd(nextEnd);
      }
    };

    const handleMouseUp = async () => {
      if (!ganttDragState) return;

      if (ganttDragState.mode === 'move') {
        const nextStart = ganttPreviewStart ?? ganttDragState.initialStart;
        await moveBookingToStart(ganttDragState.bookingId, nextStart);
      } else {
        const nextEnd = ganttPreviewEnd ?? ganttDragState.initialEnd;
        await resizeBookingToEnd(ganttDragState.bookingId, nextEnd);
      }

      setGanttDragState(null);
      setGanttPreviewStart(null);
      setGanttPreviewEnd(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [ganttDragState, ganttPreviewStart, ganttPreviewEnd, ganttRange]);

  const openDetailsModal = (nextRange?: DateRange) => {
    setPendingRange(nextRange);
    setClientName('');
    setLocation('');
    setBotCount(1);
    setActiveBookingId(null);
    setShowDetailsModal(true);
  };

  const submitDetails = async () => {
    setShowDetailsModal(false);

    if (activeBookingId) {
      try {
        const response = await fetch(getApiUrl(`/api/bookings/${activeBookingId}/details`), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientName, location, botCount }),
        });

        const data = await response.json();
        setResult({
          success: response.ok && data.success,
          message: data.message || (response.ok ? 'Booking details updated.' : 'Unable to update booking details.'),
        });

        if (response.ok && data.success) {
          await loadBookings();
        }
      } catch (error) {
        setResult({ success: false, message: 'Unable to reach the booking service.' });
      } finally {
        setActiveBookingId(null);
        setPendingRange(undefined);
      }
      return;
    }

    if (!pendingRange?.from || !pendingRange?.to) {
      setPendingRange(undefined);
      return;
    }

    await handleCreateBooking(pendingRange, { clientName, location, botCount });
    setPendingRange(undefined);
  };

  const clearSelectedBooking = () => {
    selectedBookingIdRef.current = null;
    setSelectedBookingId(null);
    setMoveTargetDate(null);
  };

  const handleCalendarBackgroundClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-day-date]')) {
      return;
    }

    clearSelectedBooking();
  };

  const renderDayButton = (props: DayButtonProps) => {
    const { day, modifiers, ...buttonProps } = props;
    const booking = getBookingForDate(day.date);
    const isBooked = Boolean(booking);
    const isActiveBookingRange = Boolean(
      booking && range?.from && range?.to && day.date >= range.from && day.date <= range.to
    );
    const isSelectedBooking = Boolean(booking && selectedBookingId === booking.id);
    const bookingStart = booking ? normalizeDay(new Date(booking.startDate)) : null;
    const bookingEnd = booking ? normalizeDay(new Date(booking.endDate)) : null;
    const activeResizeEnd = booking && selectedBookingId === booking.id && resizePreviewEnd ? resizePreviewEnd : bookingEnd;
    const isHighlightedBookingDay = Boolean(
      booking && selectedBookingId === booking.id && bookingStart && activeResizeEnd && day.date >= bookingStart && day.date <= activeResizeEnd
    );
    const isBookingStart = Boolean(booking && bookingStart && sameDay(day.date, bookingStart));
    const isBookingEnd = Boolean(booking && bookingEnd && sameDay(day.date, bookingEnd));
    const bookingLength = booking && bookingStart && bookingEnd ? differenceInDays(bookingEnd, bookingStart) + 1 : 0;
    const bookingCenterOffset = bookingLength > 1 ? Math.floor(bookingLength / 2) : 0;
    const bookingCenterDate = bookingStart && bookingLength > 0 ? addDays(bookingStart, bookingCenterOffset) : null;
    const isBookingCenter = Boolean(booking && bookingCenterDate && sameDay(day.date, bookingCenterDate));
    const isGhostPreview = Boolean(
      selectedBookingId === booking?.id && resizePreviewEnd && bookingStart && day.date >= bookingStart && day.date <= resizePreviewEnd
    );
    const isDraggingSource = Boolean(draggedBookingId && draggedBookingId === booking?.id);
    const isWeekend = day.date.getDay() === 0 || day.date.getDay() === 6;
    const isHoverTarget = dragHoverDate === day.date.toISOString();
    const isDragHoverValid = Boolean(draggedBookingId && isHoverTarget && !isWeekend && !isBooked);
    const isDragHoverBlocked = Boolean(draggedBookingId && isHoverTarget && isWeekend);
    const isPendingNewStart = Boolean(draggedBookingId && isHoverTarget && !isWeekend && !isBooked);
    const isSelectedDay = Boolean(booking && selectedBookingId === booking.id && bookingStart && bookingEnd && day.date >= bookingStart && day.date <= bookingEnd);
    const isMovePreviewDay = Boolean(booking && draggedBookingId && selectedBookingId === booking.id && isHoverTarget);
    const isMoveTargetDay = Boolean(selectedBookingIdRef.current && !booking && !isWeekend && moveTargetDate === day.date.toISOString());
    const isOutsideMonth = Boolean(modifiers.outside);
    const selectedBooking = selectedBookingId ? bookings.find((item) => item.id === selectedBookingId) : null;

    return (
      <button
        {...buttonProps}
        className={[buttonProps.className, 'booking-day-button'].filter(Boolean).join(' ')}
        data-day-date={day.date.toISOString()}
        data-booking={isBooked ? 'true' : 'false'}
        draggable={false}
        onClick={(event) => {
          if (interactionMovedRef.current) {
            event.preventDefault();
            event.stopPropagation();
            interactionMovedRef.current = false;
            return;
          }

          if (booking) {
            event.preventDefault();
            event.stopPropagation();
            const selectedRange = { from: normalizeDay(new Date(booking.startDate)), to: normalizeDay(new Date(booking.endDate)) };
            setRange(selectedRange);
            onChange?.(selectedRange);

            const nextBookingId = selectedBookingIdRef.current === booking.id ? null : booking.id;
            selectedBookingIdRef.current = nextBookingId;
            setSelectedBookingId(nextBookingId);

            setMoveTargetDate(null);

            if (!nextBookingId) {
              setResult({ success: true, message: 'Booking selection cleared.' });
              return;
            }

            setResult({ success: true, message: 'Booking selected. Click an open day to move it.' });
            return;
          }

          if (selectedBookingIdRef.current && !isWeekend) {
            event.preventDefault();
            event.stopPropagation();
            setMoveTargetDate(null);
            void handleDrop(day.date, selectedBookingIdRef.current);
            return;
          }

          buttonProps.onClick?.(event);
          selectedBookingIdRef.current = null;
          setSelectedBookingId(null);
        }}
        onDoubleClick={(event) => {
          if (!booking) return;
          event.preventDefault();
          event.stopPropagation();
          setActiveBookingId(booking.id);
          setClientName(booking.clientName);
          setLocation(booking.location);
          setBotCount(booking.botCount || 1);
          setShowDetailsModal(true);
          selectedBookingIdRef.current = booking.id;
          setSelectedBookingId(booking.id);
        }}
        onMouseDown={(event) => {
          if (!booking) return;
          event.stopPropagation();
          dragStartPointRef.current = { x: event.clientX, y: event.clientY };
          interactionMovedRef.current = false;
          draggedBookingIdRef.current = booking.id;
          setDraggedBookingId(booking.id);
          selectedBookingIdRef.current = booking.id;
          setSelectedBookingId(booking.id);
          setMoveTargetDate(null);
          setDragHoverDate(day.date.toISOString());

          if (event.detail === 2) {
            setActiveBookingId(booking.id);
            setClientName(booking.clientName);
            setLocation(booking.location);
            setBotCount(booking.botCount || 1);
            setShowDetailsModal(true);
          }
        }}
        onMouseEnter={() => {
          if (draggedBookingIdRef.current) {
            setDragHoverDate(day.date.toISOString());
          }

          if (selectedBookingIdRef.current && !booking && !isWeekend) {
            setMoveTargetDate(day.date.toISOString());
          }
        }}
        onMouseLeave={() => {
          if (moveTargetDate === day.date.toISOString()) {
            setMoveTargetDate(null);
          }
        }}
        style={{
          ...buttonProps.style,
          minHeight: '48px',
          borderRadius: '0.6rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0.2rem',
          position: 'relative',
          transition: 'all 180ms ease',
          transform: isDraggingSource ? 'scale(0.97)' : undefined,
          opacity: isDraggingSource ? 0.4 : isDragHoverBlocked ? 0.45 : isOutsideMonth ? 0.9 : 1,
          background: isMoveTargetDay
            ? 'linear-gradient(135deg, rgba(250, 204, 21, 0.35), rgba(249, 115, 22, 0.2))'
            : isSelectedDay || isMovePreviewDay
              ? 'linear-gradient(135deg, rgba(250, 204, 21, 0.18), rgba(250, 204, 21, 0.1))'
              : isOutsideMonth
                ? 'linear-gradient(135deg, rgba(241, 245, 249, 0.95), rgba(226, 232, 240, 0.72))'
                : 'linear-gradient(135deg, rgba(255, 255, 255, 0.95), rgba(248, 250, 252, 0.88))',
          backgroundColor: isMoveTargetDay ? 'rgba(250, 204, 21, 0.28)' : isSelectedDay || isMovePreviewDay ? 'rgba(250, 204, 21, 0.16)' : isOutsideMonth ? 'rgba(226, 232, 240, 0.4)' : 'rgba(255,255,255,0.7)',
          backgroundImage: 'none',
          border: isMoveTargetDay ? '2px solid rgba(217, 119, 6, 0.95)' : isSelectedDay ? '1px solid rgba(217, 119, 6, 0.95)' : isMovePreviewDay ? '1px dashed rgba(217, 119, 6, 0.8)' : isOutsideMonth ? '1px solid rgba(148, 163, 184, 0.22)' : '1px solid rgba(148, 163, 184, 0.16)',
          borderColor: isMoveTargetDay ? 'rgba(217, 119, 6, 0.95)' : isSelectedDay ? 'rgba(217, 119, 6, 0.95)' : isMovePreviewDay ? 'rgba(217, 119, 6, 0.8)' : isOutsideMonth ? 'rgba(148, 163, 184, 0.22)' : 'rgba(148, 163, 184, 0.16)',
          boxShadow: isMoveTargetDay
            ? '0 0 0 3px rgba(250, 204, 21, 0.24)'
            : isSelectedDay
              ? 'inset 0 0 0 2px rgba(250, 204, 21, 0.24)'
              : isMovePreviewDay
                ? '0 0 0 2px rgba(250, 204, 21, 0.12)'
                : isOutsideMonth
                  ? 'inset 0 1px 2px rgba(15, 23, 42, 0.05), inset 0 -1px 1px rgba(255,255,255,0.75)'
                  : '0 6px 16px rgba(15, 23, 42, 0.05)',
          outline: 'none',
          margin: 0,
          boxSizing: 'border-box',
          color: isOutsideMonth ? '#64748b' : '#102a43',
          WebkitAppearance: 'none',
          appearance: 'none',
          cursor: isDragHoverBlocked ? 'not-allowed' : isBooked ? 'grab' : 'pointer',
          animation: revertingBookingId === booking?.id ? 'revertPulse 0.4s ease' : undefined,
        }}
      >
        <span style={{ position: 'absolute', top: '0.2rem', right: '0.2rem', zIndex: 2, fontWeight: 600, fontSize: '0.7rem', lineHeight: 1, color: '#102a43', textShadow: '0 1px 0 rgba(255,255,255,0.7)' }}>{day.date.getDate()}</span>
        {isSelectedDay && (
          <span style={{ position: 'absolute', inset: '2px', borderRadius: '0.3rem', border: '1px solid rgba(217, 119, 6, 0.95)', pointerEvents: 'none' }} />
        )}
        {isMoveTargetDay && (
          <span style={{ position: 'absolute', inset: 'auto 4px 4px auto', padding: '0.15rem 0.35rem', borderRadius: '999px', background: 'rgba(217, 119, 6, 0.95)', color: '#fff', fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.02em', pointerEvents: 'none' }}>
            Move here
          </span>
        )}
        {isMovePreviewDay && (
          <span style={{ position: 'absolute', inset: '2px', borderRadius: '0.3rem', border: '1px dashed rgba(217, 119, 6, 0.8)', pointerEvents: 'none' }} />
        )}
        {isBooked && isSelectedBooking && isBookingEnd && (
          <span
            aria-label="Resize booking"
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!booking) return;
              dragStartPointRef.current = { x: event.clientX, y: event.clientY };
              interactionMovedRef.current = false;
              setSelectedBookingId(booking.id);
              selectedBookingIdRef.current = booking.id;
              setResizeState({ bookingId: booking.id, startDate: normalizeDay(new Date(booking.startDate)), endDate: normalizeDay(new Date(booking.endDate)) });
              setResizePreviewEnd(normalizeDay(new Date(booking.endDate)));
            }}
            style={{ position: 'absolute', right: '2px', top: '50%', transform: 'translateY(-50%)', width: '4px', height: '14px', borderRadius: '999px', background: 'rgba(180, 83, 9, 0.9)', cursor: 'col-resize', boxShadow: '0 0 0 1px rgba(255,255,255,0.6)', zIndex: 3, opacity: 0.95 }}
          />
        )}
      </button>
    );
  };

  const handleSelect = async (
    nextRange: DateRange | undefined,
    details: { clientName?: string; location?: string; botCount?: number } = {}
  ) => {
    if (!nextRange?.from || !nextRange?.to) {
      setRange(nextRange);
      onChange?.(nextRange);
      return;
    }

    const overlapsBookedDates = eachDayOfInterval({ start: nextRange.from, end: nextRange.to }).some((day) =>
      bookedRanges.some((item) => isWithinInterval(day, { start: item.start, end: item.end }))
    );

    if (overlapsBookedDates) {
      setResult({ success: false, message: 'Selected dates overlap an existing booking.' });
      return;
    }

    const duration = differenceInDays(nextRange.to, nextRange.from);
    if (duration < 3) {
      setResult({ success: false, message: 'Consultations must be at least 3 days.' });
      return;
    }
    if (duration > 7) {
      setResult({ success: false, message: 'Consultations must be no more than 7 days.' });
      return;
    }

    setRange(nextRange);
    onChange?.(nextRange);
    openDetailsModal(nextRange);
    return;
  };

  const handleCreateBooking = async (nextRange: DateRange, details: { clientName?: string; location?: string; botCount?: number } = {}) => {
    if (!nextRange.from || !nextRange.to) {
      return;
    }

    try {
      const response = await fetch(getApiUrl('/api/bookings'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: 'cleanbotix',
          clientName: details.clientName ?? clientName,
          location: details.location ?? location,
          botCount: details.botCount ?? botCount,
          start: nextRange.from.toISOString(),
          end: nextRange.to.toISOString(),
        }),
      });

      const data = await response.json();
      setResult({
        success: response.ok && data.success,
        message: data.message || (response.ok ? 'Booking request submitted. Awaiting admin approval.' : 'Booking failed.'),
      });

      if (response.ok && data.success) {
        await loadBookings();
      }
    } catch (error) {
      setResult({ success: false, message: 'Unable to reach the booking service.' });
    }
  };

  useEffect(() => {
    const updateOverlayRects = () => {
      const container = calendarRef.current;
      if (!container) {
        setBookingOverlayRects([]);
        return;
      }

      const dayButtons = Array.from(container.querySelectorAll<HTMLElement>('[data-day-date]'));
      const containerRect = container.getBoundingClientRect();
      const nextRects = bookings.flatMap((booking) => {
        const start = normalizeDay(new Date(booking.startDate));
        const end = normalizeDay(new Date(booking.endDate));
        const dates = eachDayOfInterval({ start, end });
        const matchingButtons = dates
          .map((date) => {
            const matchingButton = dayButtons.find((button) => {
              const dateValue = button.getAttribute('data-day-date');
              if (!dateValue) return false;
              return sameDay(normalizeDay(new Date(dateValue)), date);
            });

            return matchingButton ? { date, button: matchingButton } : null;
          })
          .filter((value): value is { date: Date; button: HTMLElement } => Boolean(value));

        if (matchingButtons.length === 0) {
          return [];
        }

        const buttons = matchingButtons.map(({ button }) => button);
        const rects = buttons.map((button) => button.getBoundingClientRect());
        const minLeft = Math.min(...rects.map((rect) => rect.left));
        const maxRight = Math.max(...rects.map((rect) => rect.right));
        const minTop = Math.min(...rects.map((rect) => rect.top));
        const maxBottom = Math.max(...rects.map((rect) => rect.bottom));

        return [{
          id: booking.id,
          left: minLeft - containerRect.left,
          top: minTop - containerRect.top,
          width: Math.max(1, maxRight - minLeft),
          height: Math.max(1, maxBottom - minTop),
          label: `${booking.clientName || 'Client'} - ${booking.location || 'Location'}`,
          dayCount: Math.max(1, matchingButtons.length),
        }];
      });

      setBookingOverlayRects(nextRects);
    };

    updateOverlayRects();
    const frame = window.requestAnimationFrame(updateOverlayRects);
    window.addEventListener('resize', updateOverlayRects);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', updateOverlayRects);
    };
  }, [bookings, selectedBookingId, calendarMonth]);

  return (
    <div className={className} style={{ display: 'grid', gap: '0.75rem', fontFamily: pageSetup.fontFamily, fontSize: pageSetup.baseFontSize, background: pageSetup.pageBackground, color: pageSetup.textColor }}>
      <style>{`
        @keyframes revertPulse {
          0% { transform: scale(1); opacity: 1; }
          35% { transform: scale(0.96); opacity: 0.78; }
          70% { transform: scale(1.01); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        .rdp-month_grid {
          border-collapse: separate;
          border-spacing: 0;
        }
        .rdp-month_rows {
          gap: 0 !important;
        }
        .rdp-row {
          margin: 0 !important;
        }
        .rdp-cell {
          padding: 0 !important;
          border: 0 !important;
          background: transparent !important;
          background-color: transparent !important;
        }
        .rdp-months {
          gap: 1.1rem !important;
        }
        .rdp-month_grid {
          border: 1px solid rgba(148,163,184,0.18) !important;
          border-radius: 0.8rem;
          overflow: hidden;
        }
        .rdp-row {
          border-top: 1px solid rgba(148,163,184,0.16) !important;
        }
        .rdp-cell {
          border-right: 1px solid rgba(148,163,184,0.16) !important;
          border-bottom: 1px solid rgba(148,163,184,0.16) !important;
        }
        .rdp-cell:last-child {
          border-right: none !important;
        }
        .rdp-row:last-child .rdp-cell {
          border-bottom: none !important;
        }
        .rdp-cell[aria-selected="true"],
        .rdp-cell[data-selected="true"],
        .rdp-selected,
        .rdp-range_start,
        .rdp-range_middle,
        .rdp-range_end {
          background: transparent !important;
          background-color: transparent !important;
        }
        .rdp-day {
          padding: 0 !important;
          margin: 0 !important;
        }
        .rdp-day_button {
          margin: 0 !important;
          border-radius: 0 !important;
          border: none !important;
          box-shadow: none !important;
          position: relative;
          z-index: 1;
          width: 100% !important;
          height: 100% !important;
          min-height: 42px;
          background: transparent !important;
          background-color: transparent !important;
          background-image: none !important;
        }
        .rdp-day_button[data-booking="true"],
        .booking-day-button {
          background: transparent !important;
          background-color: transparent !important;
          background-image: none !important;
          border: none !important;
          border-color: transparent !important;
          box-shadow: none !important;
          outline: none !important;
          isolation: isolate;
          position: relative;
          z-index: 2;
          overflow: hidden;
        }
        .rdp-day_button[aria-selected="true"],
        .rdp-day_button[aria-pressed="true"],
        .rdp-day_button--selected,
        .rdp-day_button--today,
        .booking-day-button[aria-selected="true"],
        .booking-day-button[aria-pressed="true"],
        .rdp-selected .rdp-day_button,
        .rdp-range_start .rdp-day_button,
        .rdp-range_middle .rdp-day_button,
        .rdp-range_end .rdp-day_button {
          background: transparent !important;
          background-color: transparent !important;
          background-image: none !important;
          border: none !important;
          border-color: transparent !important;
          box-shadow: none !important;
          outline: none !important;
          color: #0f3d5b !important;
          font-weight: 600 !important;
          border-radius: 0.25rem !important;
        }
        .rdp-day_button:focus,
        .rdp-day_button:focus-visible,
        .rdp-day_button:active,
        .rdp-day_button:hover,
        .booking-day-button:focus,
        .booking-day-button:focus-visible,
        .booking-day-button:active,
        .booking-day-button:hover {
          background: transparent !important;
          background-color: transparent !important;
          background-image: none !important;
          border: none !important;
          border-color: transparent !important;
          box-shadow: none !important;
          outline: none !important;
        }
      `}</style>
      {pendingBookingChange && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.35)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}>
          <div style={{ width: 'min(92vw, 320px)', background: 'rgba(255,255,255,0.95)', borderRadius: '1rem', border: '1px solid rgba(148,163,184,0.24)', boxShadow: '0 18px 45px rgba(15,23,42,0.18)', padding: '1rem', display: 'grid', gap: '0.75rem' }}>
            <div style={{ display: 'grid', gap: '0.2rem' }}>
              <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#0f172a' }}>Confirm booking change</div>
              <div style={{ fontSize: '0.9rem', color: '#475569', lineHeight: 1.45 }}>{pendingBookingChange.label}</div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button type="button" onClick={handleCancelBookingChange} style={{ border: '1px solid rgba(148,163,184,0.4)', borderRadius: '999px', padding: '0.55rem 0.85rem', background: 'rgba(255,255,255,0.75)', color: '#0f172a', fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
              <button type="button" onClick={handleConfirmBookingChange} style={{ border: 'none', borderRadius: '999px', padding: '0.55rem 0.85rem', background: 'linear-gradient(135deg, #0f766e, #2563eb)', color: 'white', fontWeight: 700, cursor: 'pointer' }}>Save change</button>
            </div>
          </div>
        </div>
      )}
      {showAdminPrompt && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.36)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1250 }}>
          <div style={{ width: 'min(92vw, 360px)', background: pageSetup.panelBackground, border: `1px solid ${pageSetup.panelBorder}`, borderRadius: '1.1rem', boxShadow: '0 24px 55px rgba(15, 23, 42, 0.2)', padding: '1rem', display: 'grid', gap: '0.8rem' }}>
            <div>
              <div style={{ fontSize: '1rem', fontWeight: 800, color: pageSetup.textColor }}>Admin access</div>
              <div style={{ fontSize: '0.8rem', color: pageSetup.mutedTextColor, lineHeight: 1.45, marginTop: '0.25rem' }}>Enter the admin passcode to open page setup.</div>
            </div>
            <input
              type="password"
              value={adminPasscodeInput}
              onChange={(event) => setAdminPasscodeInput(event.target.value)}
              placeholder="Enter passcode"
              style={{ width: '100%', minHeight: '2.75rem', padding: '0.7rem 0.8rem', borderRadius: '0.75rem', border: `1px solid ${pageSetup.panelBorder}`, background: 'white', boxSizing: 'border-box', color: pageSetup.textColor, fontWeight: 700 }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button type="button" onClick={() => setShowAdminPrompt(false)} style={{ border: '1px solid rgba(148,163,184,0.4)', borderRadius: '999px', padding: '0.55rem 0.8rem', background: 'rgba(255,255,255,0.8)', color: pageSetup.textColor, fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
              <button type="button" onClick={submitAdminSetup} style={{ border: 'none', borderRadius: '999px', padding: '0.55rem 0.8rem', background: `linear-gradient(135deg, ${pageSetup.primaryColor}, ${pageSetup.secondaryColor})`, color: 'white', fontWeight: 700, cursor: 'pointer' }}>Unlock</button>
            </div>
          </div>
        </div>
      )}
      {showSetupModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.36)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200 }}>
          <div style={{ width: 'min(94vw, 720px)', maxHeight: '90vh', overflowY: 'auto', background: pageSetup.panelBackground, border: `1px solid ${pageSetup.panelBorder}`, borderRadius: '1.25rem', boxShadow: '0 24px 55px rgba(15, 23, 42, 0.2)', padding: '1rem', display: 'grid', gap: '0.9rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
              <div>
                <div style={{ fontSize: '1rem', fontWeight: 800, color: pageSetup.textColor }}>Page setup</div>
                <div style={{ fontSize: '0.8rem', color: pageSetup.mutedTextColor, lineHeight: 1.45 }}>Adjust fonts, theme colors, and calendar presentation for the scheduler.</div>
              </div>
              <button type="button" onClick={() => setShowSetupModal(false)} style={{ border: '1px solid rgba(148,163,184,0.4)', borderRadius: '999px', padding: '0.5rem 0.8rem', background: 'rgba(255,255,255,0.8)', color: pageSetup.textColor, fontWeight: 700, cursor: 'pointer' }}>Close</button>
            </div>
            <div style={{ display: 'grid', gap: '0.8rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
              <label style={{ display: 'grid', gap: '0.35rem' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 800, color: pageSetup.mutedTextColor, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Font family</span>
                <select value={pageSetup.fontFamily} onChange={(event) => setPageSetup((current) => ({ ...current, fontFamily: event.target.value }))} style={{ border: `1px solid ${pageSetup.panelBorder}`, borderRadius: '0.75rem', padding: '0.65rem 0.75rem', background: 'white', color: pageSetup.textColor, fontFamily: pageSetup.fontFamily }}>
                  <option value="Inter, system-ui, sans-serif" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>Inter</option>
                  <option value="'Roboto', system-ui, sans-serif" style={{ fontFamily: 'Roboto, system-ui, sans-serif' }}>Roboto</option>
                  <option value="'Poppins', system-ui, sans-serif" style={{ fontFamily: 'Poppins, system-ui, sans-serif' }}>Poppins</option>
                  <option value="'Montserrat', system-ui, sans-serif" style={{ fontFamily: 'Montserrat, system-ui, sans-serif' }}>Montserrat</option>
                  <option value="'Open Sans', system-ui, sans-serif" style={{ fontFamily: 'Open Sans, system-ui, sans-serif' }}>Open Sans</option>
                  <option value="'Nunito', system-ui, sans-serif" style={{ fontFamily: 'Nunito, system-ui, sans-serif' }}>Nunito</option>
                  <option value="'Lato', system-ui, sans-serif" style={{ fontFamily: 'Lato, system-ui, sans-serif' }}>Lato</option>
                  <option value="'Source Sans 3', system-ui, sans-serif" style={{ fontFamily: 'Source Sans 3, system-ui, sans-serif' }}>Source Sans 3</option>
                  <option value="'Raleway', system-ui, sans-serif" style={{ fontFamily: 'Raleway, system-ui, sans-serif' }}>Raleway</option>
                  <option value="'Merriweather', serif" style={{ fontFamily: 'Merriweather, serif' }}>Merriweather</option>
                  <option value="'Playfair Display', serif" style={{ fontFamily: 'Playfair Display, serif' }}>Playfair Display</option>
                  <option value="'Space Grotesk', system-ui, sans-serif" style={{ fontFamily: 'Space Grotesk, system-ui, sans-serif' }}>Space Grotesk</option>
                  <option value="'Manrope', system-ui, sans-serif" style={{ fontFamily: 'Manrope, system-ui, sans-serif' }}>Manrope</option>
                  <option value="'DM Sans', system-ui, sans-serif" style={{ fontFamily: 'DM Sans, system-ui, sans-serif' }}>DM Sans</option>
                  <option value="'Segoe UI', sans-serif" style={{ fontFamily: 'Segoe UI, sans-serif' }}>Segoe UI</option>
                  <option value="Georgia, serif" style={{ fontFamily: 'Georgia, serif' }}>Georgia</option>
                  <option value="'Courier New', monospace" style={{ fontFamily: 'Courier New, monospace' }}>Courier New</option>
                </select>
              </label>
              <label style={{ display: 'grid', gap: '0.35rem' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 800, color: pageSetup.mutedTextColor, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Base size</span>
                <select value={pageSetup.baseFontSize} onChange={(event) => setPageSetup((current) => ({ ...current, baseFontSize: event.target.value }))} style={{ border: `1px solid ${pageSetup.panelBorder}`, borderRadius: '0.75rem', padding: '0.65rem 0.75rem', background: 'white', color: pageSetup.textColor }}>
                  <option value="14px">14px</option>
                  <option value="15px">15px</option>
                  <option value="16px">16px</option>
                  <option value="17px">17px</option>
                  <option value="18px">18px</option>
                </select>
              </label>
              <label style={{ display: 'grid', gap: '0.35rem' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 800, color: pageSetup.mutedTextColor, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Accent color</span>
                <input type="color" value={pageSetup.primaryColor} onChange={(event) => setPageSetup((current) => ({ ...current, primaryColor: event.target.value }))} style={{ width: '100%', height: '2.75rem', padding: '0.2rem', borderRadius: '0.75rem', border: `1px solid ${pageSetup.panelBorder}`, background: 'white' }} />
              </label>
              <label style={{ display: 'grid', gap: '0.35rem' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 800, color: pageSetup.mutedTextColor, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Secondary color</span>
                <input type="color" value={pageSetup.secondaryColor} onChange={(event) => setPageSetup((current) => ({ ...current, secondaryColor: event.target.value }))} style={{ width: '100%', height: '2.75rem', padding: '0.2rem', borderRadius: '0.75rem', border: `1px solid ${pageSetup.panelBorder}`, background: 'white' }} />
              </label>
              <label style={{ display: 'grid', gap: '0.35rem' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 800, color: pageSetup.mutedTextColor, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Page background</span>
                <input type="color" value={pageSetup.pageBackground} onChange={(event) => setPageSetup((current) => ({ ...current, pageBackground: event.target.value }))} style={{ width: '100%', height: '2.75rem', padding: '0.2rem', borderRadius: '0.75rem', border: `1px solid ${pageSetup.panelBorder}`, background: 'white' }} />
              </label>
              <label style={{ display: 'grid', gap: '0.35rem' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 800, color: pageSetup.mutedTextColor, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Panel background</span>
                <input type="color" value={pageSetup.panelBackground} onChange={(event) => setPageSetup((current) => ({ ...current, panelBackground: event.target.value }))} style={{ width: '100%', height: '2.75rem', padding: '0.2rem', borderRadius: '0.75rem', border: `1px solid ${pageSetup.panelBorder}`, background: 'white' }} />
              </label>
              <label style={{ display: 'grid', gap: '0.35rem' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 800, color: pageSetup.mutedTextColor, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Text color</span>
                <input type="color" value={pageSetup.textColor} onChange={(event) => setPageSetup((current) => ({ ...current, textColor: event.target.value }))} style={{ width: '100%', height: '2.75rem', padding: '0.2rem', borderRadius: '0.75rem', border: `1px solid ${pageSetup.panelBorder}`, background: 'white' }} />
              </label>
              <label style={{ display: 'grid', gap: '0.35rem' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 800, color: pageSetup.mutedTextColor, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Muted text</span>
                <input type="color" value={pageSetup.mutedTextColor} onChange={(event) => setPageSetup((current) => ({ ...current, mutedTextColor: event.target.value }))} style={{ width: '100%', height: '2.75rem', padding: '0.2rem', borderRadius: '0.75rem', border: `1px solid ${pageSetup.panelBorder}`, background: 'white' }} />
              </label>
              <label style={{ display: 'grid', gap: '0.35rem' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 800, color: pageSetup.mutedTextColor, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Calendar surface</span>
                <input type="color" value={pageSetup.calendarSurface} onChange={(event) => setPageSetup((current) => ({ ...current, calendarSurface: event.target.value }))} style={{ width: '100%', height: '2.75rem', padding: '0.2rem', borderRadius: '0.75rem', border: `1px solid ${pageSetup.panelBorder}`, background: 'white' }} />
              </label>
              <label style={{ display: 'grid', gap: '0.35rem' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 800, color: pageSetup.mutedTextColor, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Calendar highlight</span>
                <input type="color" value={pageSetup.calendarAccent} onChange={(event) => setPageSetup((current) => ({ ...current, calendarAccent: event.target.value }))} style={{ width: '100%', height: '2.75rem', padding: '0.2rem', borderRadius: '0.75rem', border: `1px solid ${pageSetup.panelBorder}`, background: 'white' }} />
              </label>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', alignItems: 'center', justifyContent: 'space-between' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', color: pageSetup.mutedTextColor, fontWeight: 700 }}>
                <input type="checkbox" checked={pageSetup.weekendShade} onChange={(event) => setPageSetup((current) => ({ ...current, weekendShade: event.target.checked }))} />
                Shade weekends
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', color: pageSetup.mutedTextColor, fontWeight: 700 }}>
                <input type="checkbox" checked={pageSetup.compactCells} onChange={(event) => setPageSetup((current) => ({ ...current, compactCells: event.target.checked }))} />
                Compact day cells
              </label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="button" onClick={resetPageSetup} style={{ border: '1px solid rgba(148,163,184,0.4)', borderRadius: '999px', padding: '0.55rem 0.8rem', background: 'rgba(255,255,255,0.8)', color: pageSetup.textColor, fontWeight: 700, cursor: 'pointer' }}>Reset</button>
                <button type="button" onClick={() => setShowSetupModal(false)} style={{ border: 'none', borderRadius: '999px', padding: '0.55rem 0.8rem', background: `linear-gradient(135deg, ${pageSetup.primaryColor}, ${pageSetup.secondaryColor})`, color: 'white', fontWeight: 700, cursor: 'pointer' }}>Apply</button>
              </div>
            </div>
            <div style={{ display: 'grid', gap: '0.6rem', padding: '0.8rem', borderRadius: '1rem', border: `1px solid ${pageSetup.panelBorder}`, background: 'linear-gradient(135deg, rgba(255,255,255,0.75), rgba(248,250,252,0.9))' }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 800, color: pageSetup.mutedTextColor, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Live preview</div>
              <div style={{ display: 'grid', gap: '0.6rem', padding: '0.75rem', borderRadius: '0.95rem', background: pageSetup.pageBackground, border: `1px solid ${pageSetup.panelBorder}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                  <div style={{ fontSize: '0.95rem', fontWeight: 800, color: pageSetup.textColor, fontFamily: pageSetup.fontFamily }}>Schedule preview</div>
                  <div style={{ display: 'inline-flex', gap: '0.35rem' }}>
                    <span style={{ borderRadius: '999px', padding: '0.3rem 0.55rem', background: pageSetup.primaryColor, color: 'white', fontSize: '0.7rem', fontWeight: 700 }}>Calendar</span>
                    <span style={{ borderRadius: '999px', padding: '0.3rem 0.55rem', background: pageSetup.secondaryColor, color: 'white', fontSize: '0.7rem', fontWeight: 700 }}>Gantt</span>
                  </div>
                </div>
                <div style={{ display: 'grid', gap: '0.4rem', padding: '0.65rem', borderRadius: '0.85rem', background: pageSetup.calendarSurface, border: `1px solid ${pageSetup.panelBorder}` }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '0.25rem' }}>
                    {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((label, index) => (
                      <div key={label} style={{ borderRadius: '0.45rem', padding: '0.2rem 0', textAlign: 'center', fontSize: '0.68rem', fontWeight: 700, color: pageSetup.mutedTextColor, background: pageSetup.weekendShade && (index === 0 || index === 6) ? 'rgba(148,163,184,0.14)' : 'transparent' }}>{label}</div>
                    ))}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '0.25rem' }}>
                    {Array.from({ length: 7 }).map((_, index) => (
                      <div key={index} style={{ minHeight: pageSetup.compactCells ? '32px' : '44px', borderRadius: '0.45rem', border: `1px solid ${pageSetup.panelBorder}`, background: pageSetup.weekendShade && (index === 0 || index === 6) ? 'rgba(148,163,184,0.14)' : 'rgba(255,255,255,0.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', padding: '0.2rem', color: pageSetup.textColor, fontSize: '0.68rem', fontWeight: 700 }}>{index + 1}</div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.4rem', fontSize: '0.72rem', color: pageSetup.mutedTextColor }}>
                    <span>Selected range</span>
                    <span style={{ color: pageSetup.primaryColor, fontWeight: 700 }}>3 days • 2 installers</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {showDetailsModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.36)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: 'rgba(255,255,255,0.9)',
              padding: '1rem',
              borderRadius: '1rem',
              width: 'min(92vw, 360px)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
              border: '1px solid rgba(255,255,255,0.45)',
              boxShadow: '0 20px 45px rgba(15,23,42,0.18)',
              backdropFilter: 'blur(18px)',
              WebkitBackdropFilter: 'blur(18px)',
              overflow: 'hidden',
              position: 'relative',
              isolation: 'isolate',
            }}
          >
            <h3 style={{ margin: 0, color: '#0f172a' }}>Staffing assignment</h3>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', minHeight: '3.5rem' }}>
              <span style={{ fontWeight: 600, color: '#334155', lineHeight: 1.2 }}>Team / Client</span>
              <input
                value={clientName}
                onChange={(event) => setClientName(event.target.value)}
                placeholder="Client name"
                style={{ width: '100%', minHeight: '2.75rem', padding: '0.7rem 0.8rem', borderRadius: '0.75rem', border: '1px solid rgba(148, 163, 184, 0.55)', background: 'rgba(255,255,255,0.98)', boxSizing: 'border-box', fontSize: '0.95rem', lineHeight: 1.4, color: '#020617', fontWeight: 600, boxShadow: 'inset 0 1px 1px rgba(15, 23, 42, 0.04)' }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', minHeight: '3.5rem' }}>
              <span style={{ fontWeight: 600, color: '#334155', lineHeight: 1.2 }}>Destination</span>
              <input
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                placeholder="Location"
                style={{ width: '100%', minHeight: '2.75rem', padding: '0.7rem 0.8rem', borderRadius: '0.75rem', border: '1px solid rgba(148, 163, 184, 0.55)', background: 'rgba(255,255,255,0.98)', boxSizing: 'border-box', fontSize: '0.95rem', lineHeight: 1.4, color: '#020617', fontWeight: 600, boxShadow: 'inset 0 1px 1px rgba(15, 23, 42, 0.04)' }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', minHeight: '3.5rem' }}>
              <span style={{ fontWeight: 600, color: '#334155', lineHeight: 1.2 }}>Number of bots</span>
              <input
                type="number"
                min="1"
                value={botCount}
                onChange={(event) => setBotCount(Number(event.target.value) || 1)}
                style={{ width: '100%', minHeight: '2.75rem', padding: '0.7rem 0.8rem', borderRadius: '0.75rem', border: '1px solid rgba(148, 163, 184, 0.55)', background: 'rgba(255,255,255,0.98)', boxSizing: 'border-box', fontSize: '0.95rem', lineHeight: 1.4, color: '#020617', fontWeight: 600, boxShadow: 'inset 0 1px 1px rgba(15, 23, 42, 0.04)' }}
              />
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.15rem' }}>
              <button type="button" onClick={() => setShowDetailsModal(false)} style={{ border: '1px solid rgba(148,163,184,0.4)', borderRadius: '999px', padding: '0.55rem 0.85rem', background: 'rgba(255,255,255,0.75)' }}>
                Cancel
              </button>
              <button type="button" onClick={submitDetails} style={{ border: 'none', borderRadius: '999px', padding: '0.55rem 0.85rem', background: 'linear-gradient(135deg, #0f766e, #2563eb)', color: 'white' }}>
                Save assignment
              </button>
            </div>
          </div>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative' }}>
            <button type="button" onClick={() => setShowFileMenu((current) => !current)} style={{ border: 'none', borderRadius: '0.1rem', padding: '0.5rem 0.8rem', background: showFileMenu ? `linear-gradient(135deg, ${pageSetup.primaryColor}, ${pageSetup.secondaryColor})` : 'transparent', color: showFileMenu ? 'white' : pageSetup.mutedTextColor, fontWeight: 800, cursor: 'pointer', transition: 'all 180ms ease', boxShadow: 'none' }} onMouseEnter={(event) => { event.currentTarget.style.background = showFileMenu ? `linear-gradient(135deg, ${pageSetup.primaryColor}, ${pageSetup.secondaryColor})` : 'rgba(148, 163, 184, 0.16)'; event.currentTarget.style.color = showFileMenu ? 'white' : pageSetup.textColor; event.currentTarget.style.boxShadow = '0 4px 10px rgba(15, 23, 42, 0.08)'; }} onMouseLeave={(event) => { event.currentTarget.style.background = showFileMenu ? `linear-gradient(135deg, ${pageSetup.primaryColor}, ${pageSetup.secondaryColor})` : 'transparent'; event.currentTarget.style.color = showFileMenu ? 'white' : pageSetup.mutedTextColor; event.currentTarget.style.boxShadow = 'none'; }}>File</button>
            {showFileMenu && (
              <div style={{ position: 'absolute', top: 'calc(100% + 0.4rem)', left: 0, zIndex: 8, minWidth: '13rem', display: 'grid', gap: '0.3rem', padding: '0.4rem', borderRadius: '0.95rem', border: '1px solid rgba(148,163,184,0.24)', background: pageSetup.panelBackground, boxShadow: '0 16px 42px rgba(15,23,42,0.16)' }}>
                <button type="button" onClick={() => window.open('/api/bookings/export?format=csv', '_blank')} style={{ border: 'none', borderRadius: '0.7rem', padding: '0.5rem 0.6rem', background: '#eefbf4', color: '#166534', fontWeight: 800, cursor: 'pointer', textAlign: 'left' }}>Export CSV</button>
                {isAdminMode ? (
                  <button type="button" onClick={() => { setShowSetupModal(true); setShowFileMenu(false); }} style={{ border: 'none', borderRadius: '0.7rem', padding: '0.5rem 0.6rem', background: '#f5f3ff', color: '#6d28d9', fontWeight: 800, cursor: 'pointer', textAlign: 'left' }}>Page setup</button>
                ) : (
                  <button type="button" onClick={openAdminSetup} style={{ border: 'none', borderRadius: '0.7rem', padding: '0.5rem 0.6rem', background: '#f5f3ff', color: '#6d28d9', fontWeight: 800, cursor: 'pointer', textAlign: 'left' }}>Admin setup</button>
                )}
                <button type="button" onClick={() => setShowSaveAsInput((current) => !current)} style={{ border: 'none', borderRadius: '0.7rem', padding: '0.5rem 0.6rem', background: '#eff6ff', color: '#1d4ed8', fontWeight: 800, cursor: 'pointer', textAlign: 'left' }}>Save as</button>
                <button type="button" onClick={clearSavedSession} style={{ border: 'none', borderRadius: '0.7rem', padding: '0.5rem 0.6rem', background: '#fef2f2', color: '#b91c1c', fontWeight: 800, cursor: 'pointer', textAlign: 'left' }}>Clear saved session</button>
                {showSaveAsInput && (
                  <div style={{ display: 'grid', gap: '0.35rem', padding: '0.2rem 0.1rem 0.1rem' }}>
                    <input
                      value={saveAsName}
                      onChange={(event) => setSaveAsName(event.target.value)}
                      placeholder="Session name"
                      style={{ border: '1px solid rgba(148,163,184,0.3)', borderRadius: '0.7rem', padding: '0.5rem 0.6rem', fontSize: '0.8rem', fontWeight: 700, color: '#0f172a' }}
                    />
                    <button type="button" onClick={() => saveCurrentSession(saveAsName)} style={{ border: 'none', borderRadius: '0.7rem', padding: '0.5rem 0.6rem', background: '#0f766e', color: 'white', fontWeight: 800, cursor: 'pointer', textAlign: 'left' }}>Save snapshot</button>
                  </div>
                )}
                <button type="button" onClick={restoreLastSession} style={{ border: 'none', borderRadius: '0.7rem', padding: '0.5rem 0.6rem', background: '#f8fafc', color: '#0f172a', fontWeight: 700, cursor: 'pointer', textAlign: 'left' }}>Restore last saved session</button>
                {savedSessionLabel && (
                  <div style={{ padding: '0.25rem 0.2rem 0.1rem', fontSize: '0.72rem', color: '#64748b', fontWeight: 700 }}>Last saved: {savedSessionLabel}</div>
                )}
              </div>
            )}
          </div>
          <button type="button" onClick={() => setViewMode('installers')} style={{ border: 'none', borderRadius: '0.1rem', padding: '0.5rem 0.8rem', background: viewMode === 'installers' ? `linear-gradient(135deg, ${pageSetup.primaryColor}, ${pageSetup.secondaryColor})` : 'transparent', color: viewMode === 'installers' ? 'white' : pageSetup.mutedTextColor, fontWeight: 800, cursor: 'pointer', transition: 'all 180ms ease', boxShadow: 'none' }} onMouseEnter={(event) => { event.currentTarget.style.background = viewMode === 'installers' ? `linear-gradient(135deg, ${pageSetup.primaryColor}, ${pageSetup.secondaryColor})` : 'rgba(148, 163, 184, 0.16)'; event.currentTarget.style.color = viewMode === 'installers' ? 'white' : pageSetup.textColor; event.currentTarget.style.boxShadow = '0 4px 10px rgba(15, 23, 42, 0.08)'; }} onMouseLeave={(event) => { event.currentTarget.style.background = viewMode === 'installers' ? `linear-gradient(135deg, ${pageSetup.primaryColor}, ${pageSetup.secondaryColor})` : 'transparent'; event.currentTarget.style.color = viewMode === 'installers' ? 'white' : pageSetup.mutedTextColor; event.currentTarget.style.boxShadow = 'none'; }}>Current Installers</button>
        </div>
        <div style={{ display: 'inline-flex', borderRadius: '0.2rem', padding: '0.23rem', background: 'rgba(255,255,255,0.82)', border: `1px solid ${pageSetup.panelBorder}`, boxShadow: '0 8px 24px rgba(15,23,42,0.08)' }}>
          <button type="button" onClick={() => setViewMode('calendar')} style={{ border: 'none', borderRadius: '0.1rem', padding: '0.5rem 0.8rem', background: viewMode === 'calendar' ? `linear-gradient(135deg, ${pageSetup.primaryColor}, ${pageSetup.secondaryColor})` : 'transparent', color: viewMode === 'calendar' ? 'white' : pageSetup.mutedTextColor, fontWeight: 800, cursor: 'pointer', transition: 'all 180ms ease', boxShadow: 'none' }} onMouseEnter={(event) => { event.currentTarget.style.background = viewMode === 'calendar' ? `linear-gradient(135deg, ${pageSetup.primaryColor}, ${pageSetup.secondaryColor})` : 'rgba(148, 163, 184, 0.16)'; event.currentTarget.style.color = viewMode === 'calendar' ? 'white' : pageSetup.textColor; event.currentTarget.style.boxShadow = '0 4px 10px rgba(15, 23, 42, 0.08)'; }} onMouseLeave={(event) => { event.currentTarget.style.background = viewMode === 'calendar' ? `linear-gradient(135deg, ${pageSetup.primaryColor}, ${pageSetup.secondaryColor})` : 'transparent'; event.currentTarget.style.color = viewMode === 'calendar' ? 'white' : pageSetup.mutedTextColor; event.currentTarget.style.boxShadow = 'none'; }}>Calendar</button>
          <button type="button" onClick={() => setViewMode('gantt')} style={{ border: 'none', borderRadius: '0.1rem', padding: '0.5rem 0.8rem', background: viewMode === 'gantt' ? `linear-gradient(135deg, ${pageSetup.primaryColor}, ${pageSetup.secondaryColor})` : 'transparent', color: viewMode === 'gantt' ? 'white' : pageSetup.mutedTextColor, fontWeight: 800, cursor: 'pointer', transition: 'all 180ms ease', boxShadow: 'none' }} onMouseEnter={(event) => { event.currentTarget.style.background = viewMode === 'gantt' ? `linear-gradient(135deg, ${pageSetup.primaryColor}, ${pageSetup.secondaryColor})` : 'rgba(148, 163, 184, 0.16)'; event.currentTarget.style.color = viewMode === 'gantt' ? 'white' : pageSetup.textColor; event.currentTarget.style.boxShadow = '0 4px 10px rgba(15, 23, 42, 0.08)'; }} onMouseLeave={(event) => { event.currentTarget.style.background = viewMode === 'gantt' ? `linear-gradient(135deg, ${pageSetup.primaryColor}, ${pageSetup.secondaryColor})` : 'transparent'; event.currentTarget.style.color = viewMode === 'gantt' ? 'white' : pageSetup.mutedTextColor; event.currentTarget.style.boxShadow = 'none'; }}>Gantt</button>
          <button type="button" onClick={() => setViewMode('capacity')} style={{ border: 'none', borderRadius: '0.1rem', padding: '0.5rem 0.8rem', background: viewMode === 'capacity' ? `linear-gradient(135deg, ${pageSetup.primaryColor}, ${pageSetup.secondaryColor})` : 'transparent', color: viewMode === 'capacity' ? 'white' : pageSetup.mutedTextColor, fontWeight: 800, cursor: 'pointer', transition: 'all 180ms ease', boxShadow: 'none' }} onMouseEnter={(event) => { event.currentTarget.style.background = viewMode === 'capacity' ? `linear-gradient(135deg, ${pageSetup.primaryColor}, ${pageSetup.secondaryColor})` : 'rgba(148, 163, 184, 0.16)'; event.currentTarget.style.color = viewMode === 'capacity' ? 'white' : pageSetup.textColor; event.currentTarget.style.boxShadow = '0 4px 10px rgba(15, 23, 42, 0.08)'; }} onMouseLeave={(event) => { event.currentTarget.style.background = viewMode === 'capacity' ? `linear-gradient(135deg, ${pageSetup.primaryColor}, ${pageSetup.secondaryColor})` : 'transparent'; event.currentTarget.style.color = viewMode === 'capacity' ? 'white' : pageSetup.mutedTextColor; event.currentTarget.style.boxShadow = 'none'; }}>Capacity Planner</button>
        </div>
      </div>
      <section style={{ marginTop: '0.75rem', borderRadius: '0.95rem', border: `1px solid ${pageSetup.panelBorder}`, background: 'rgba(255,255,255,0.78)', padding: '0.75rem' }}>
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          <div style={{ fontSize: '0.9rem', fontWeight: 800, color: pageSetup.textColor }}>Dispatch Routing (Cal.com)</div>
          <div style={{ fontSize: '0.78rem', color: pageSetup.mutedTextColor }}>
            Generate an intelligent setup link by ZIP + product. This does not push anything into Smartsheet.
          </div>
          <div style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
            <input
              value={dispatchZip}
              onChange={(event) => setDispatchZip(event.target.value)}
              placeholder="Client ZIP (e.g. 60611)"
              style={{ border: '1px solid rgba(148,163,184,0.35)', borderRadius: '0.65rem', padding: '0.55rem 0.65rem', fontSize: '0.82rem', color: '#0f172a' }}
            />
            <input
              value={dispatchProduct}
              onChange={(event) => setDispatchProduct(event.target.value)}
              placeholder="Product model"
              style={{ border: '1px solid rgba(148,163,184,0.35)', borderRadius: '0.65rem', padding: '0.55rem 0.65rem', fontSize: '0.82rem', color: '#0f172a' }}
            />
            <button
              type="button"
              onClick={() => void generateDispatchLink()}
              disabled={isDispatching}
              style={{ border: 'none', borderRadius: '0.65rem', background: 'linear-gradient(135deg, #0f766e, #2563eb)', color: 'white', padding: '0.55rem 0.75rem', fontSize: '0.8rem', fontWeight: 800, cursor: isDispatching ? 'default' : 'pointer' }}
            >
              {isDispatching ? 'Generating...' : 'Generate setup link'}
            </button>
          </div>
          {dispatchResult?.success && dispatchResult.bookingUrl ? (
            <div style={{ display: 'grid', gap: '0.3rem', padding: '0.55rem', borderRadius: '0.65rem', border: '1px solid rgba(16,185,129,0.25)', background: '#ecfdf5' }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#065f46' }}>
                Team: {dispatchResult.assignedTeam?.manager || 'Manager'} + {dispatchResult.assignedTeam?.technician || 'Technician'}
              </div>
              <div style={{ fontSize: '0.78rem', color: '#065f46' }}>Territory: {dispatchResult.territory || 'Unknown'}</div>
              <a href={dispatchResult.bookingUrl} target="_blank" rel="noreferrer" style={{ fontSize: '0.78rem', color: '#1d4ed8', fontWeight: 700, wordBreak: 'break-all' }}>
                {dispatchResult.bookingUrl}
              </a>
            </div>
          ) : null}
          {dispatchResult && !dispatchResult.success ? (
            <div style={{ fontSize: '0.78rem', color: '#991b1b', fontWeight: 700 }}>{dispatchResult.message || 'Dispatch link generation failed.'}</div>
          ) : null}
        </div>
      </section>
      <div ref={calendarRef} onClick={handleCalendarBackgroundClick} style={{ position: 'relative', padding: '0.75rem', borderRadius: '18px', background: pageSetup.calendarSurface, border: `1px solid ${pageSetup.panelBorder}`, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.45)' }}>
        {viewMode === 'installers' ? (
          <div style={{ display: 'grid', gap: '0.85rem' }}>
            <div style={{ display: 'grid', gap: '0.25rem' }}>
              <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#0f172a' }}>Current Installers</div>
              <div style={{ fontSize: '0.8rem', color: '#475569', lineHeight: 1.45 }}>Trevor and Praneeth are the active installers by default. The numbered placeholders stay inactive so you can add them later to model capacity needs.</div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
              <input
                value={newInstallerName}
                onChange={(event) => setNewInstallerName(event.target.value)}
                placeholder="Add placeholder"
                style={{ minWidth: '14rem', border: '1px solid rgba(148,163,184,0.3)', borderRadius: '0.7rem', padding: '0.55rem 0.7rem', fontSize: '0.8rem', fontWeight: 700, color: '#0f172a' }}
              />
              <button type="button" onClick={() => addInstallerToRoster(newInstallerName)} style={{ border: 'none', borderRadius: '0.7rem', background: '#0f766e', color: 'white', padding: '0.55rem 0.8rem', fontSize: '0.78rem', fontWeight: 800, cursor: 'pointer' }}>Add placeholder</button>
            </div>
            <div style={{ display: 'grid', gap: '0.7rem' }}>
              <div style={{ display: 'grid', gap: '0.35rem' }}>
                <div style={{ fontSize: '0.84rem', fontWeight: 800, color: '#0f172a' }}>Active installers</div>
                {activeInstallers.map((person) => (
                  <div key={person} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem', padding: '0.7rem 0.8rem', borderRadius: '0.9rem', border: '1px solid rgba(34,197,94,0.24)', background: '#f0fdf4' }}>
                    <div style={{ display: 'grid', gap: '0.12rem' }}>
                      {editingInstallerName === person ? (
                        <input
                          autoFocus
                          value={installerNameDraft}
                          onChange={(event) => setInstallerNameDraft(event.target.value)}
                          onBlur={() => saveInstallerName(person)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              saveInstallerName(person);
                            }
                            if (event.key === 'Escape') {
                              event.preventDefault();
                              setEditingInstallerName(null);
                              setInstallerNameDraft(installerNames[person] || person);
                            }
                          }}
                          style={{ border: '1px solid rgba(148,163,184,0.3)', borderRadius: '0.5rem', padding: '0.25rem 0.45rem', fontSize: '0.8rem', fontWeight: 800, color: '#0f172a', minWidth: '8rem' }}
                        />
                      ) : (
                        <div style={{ fontSize: '0.84rem', fontWeight: 800, color: '#0f172a' }}>{installerNames[person] || person}</div>
                      )}
                      <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b' }}>Shown in Gantt and capacity planner</div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.35rem' }}>
                      <button type="button" onClick={() => startEditingInstallerName(person)} style={{ border: '1px solid rgba(148,163,184,0.22)', borderRadius: '999px', background: '#ffffff', color: '#0f172a', padding: '0.35rem 0.6rem', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer' }}>Edit</button>
                      <button type="button" onClick={() => toggleInstallerActive(person)} style={{ border: '1px solid rgba(148,163,184,0.22)', borderRadius: '999px', background: '#ffffff', color: '#0f172a', padding: '0.35rem 0.6rem', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer' }}>Set inactive</button>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'grid', gap: '0.35rem' }}>
                <div style={{ fontSize: '0.84rem', fontWeight: 800, color: '#0f172a' }}>Inactive installers</div>
                {inactiveInstallers.map((person) => (
                  <div key={person} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem', padding: '0.7rem 0.8rem', borderRadius: '0.9rem', border: '1px solid rgba(148,163,184,0.16)', background: '#ffffff' }}>
                    <div style={{ display: 'grid', gap: '0.12rem' }}>
                      {editingInstallerName === person ? (
                        <input
                          autoFocus
                          value={installerNameDraft}
                          onChange={(event) => setInstallerNameDraft(event.target.value)}
                          onBlur={() => saveInstallerName(person)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              saveInstallerName(person);
                            }
                            if (event.key === 'Escape') {
                              event.preventDefault();
                              setEditingInstallerName(null);
                              setInstallerNameDraft(installerNames[person] || person);
                            }
                          }}
                          style={{ border: '1px solid rgba(148,163,184,0.3)', borderRadius: '0.5rem', padding: '0.25rem 0.45rem', fontSize: '0.8rem', fontWeight: 800, color: '#0f172a', minWidth: '8rem' }}
                        />
                      ) : (
                        <div style={{ fontSize: '0.84rem', fontWeight: 800, color: '#0f172a' }}>{installerNames[person] || person}</div>
                      )}
                      <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b' }}>Available as a planning placeholder</div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.35rem' }}>
                      <button type="button" onClick={() => startEditingInstallerName(person)} style={{ border: '1px solid rgba(148,163,184,0.22)', borderRadius: '999px', background: '#f8fafc', color: '#0f172a', padding: '0.35rem 0.6rem', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer' }}>Edit</button>
                      <button type="button" onClick={() => toggleInstallerActive(person)} style={{ border: '1px solid rgba(14,116,144,0.22)', borderRadius: '999px', background: '#eff6ff', color: '#0f172a', padding: '0.35rem 0.6rem', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer' }}>Set active</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : viewMode === 'calendar' && bookingOverlayRects.map((overlay) => {
          const isSelected = overlay.id === selectedBookingId;
          return (
            <div
              key={overlay.id}
              style={{
                position: 'absolute',
                left: overlay.left,
                top: overlay.top,
                width: overlay.width,
                height: overlay.height,
                borderRadius: '0.55rem',
                background: isSelected
                  ? 'linear-gradient(135deg, rgba(191, 219, 254, 0.95) 0%, rgba(147, 197, 253, 0.9) 100%)'
                  : 'linear-gradient(135deg, rgba(224, 242, 254, 0.76) 0%, rgba(191, 219, 254, 0.72) 100%)',
                border: isSelected ? '1px solid rgba(217, 119, 6, 0.95)' : '1px solid rgba(148, 163, 184, 0.22)',
                boxShadow: isSelected ? '0 0 0 2px rgba(250, 204, 21, 0.2)' : 'inset 0 1px 0 rgba(255,255,255,0.42)',
                pointerEvents: 'none',
                zIndex: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                padding: '0.2rem 0.35rem',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  backgroundImage: `linear-gradient(to right, rgba(148,163,184,0.16) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.16) 1px, transparent 1px)`,
                  backgroundSize: `${overlay.dayCount > 1 ? `calc(100% / ${overlay.dayCount})` : '100%'} 100%`,
                  opacity: 0.38,
                }}
              />
              <span style={{ position: 'relative', zIndex: 1, fontSize: '0.68rem', fontWeight: 800, color: '#0f3d5b', textAlign: 'center', padding: '0 0.25rem', lineHeight: 1.1, letterSpacing: '0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{overlay.label}</span>
            </div>
          );
        })}
        {viewMode === 'calendar' ? (
          <div style={{ padding: '0.9rem', borderRadius: '1.25rem', background: 'linear-gradient(135deg, rgba(255,255,255,0.95), rgba(248,250,252,0.9))', border: '1px solid rgba(148,163,184,0.22)', boxShadow: '0 20px 45px rgba(15,23,42,0.08)' }}>
            <DayPicker
              mode="range"
              selected={range}
              onMonthChange={(nextMonth) => {
                setCalendarMonth(nextMonth);
              }}
              onSelect={(nextRange) => {
                if (!nextRange?.from || !nextRange?.to) {
                  setRange(nextRange);
                  onChange?.(nextRange);
                  return;
                }
                setRange(nextRange);
                onChange?.(nextRange);
                openDetailsModal(nextRange);
              }}
              min={3}
              max={7}
              numberOfMonths={2}
              showOutsideDays
              modifiers={bookedModifier}
              modifiersStyles={{
                disabled: { color: 'red', textDecoration: 'line-through' },
                booked: { backgroundColor: 'transparent', color: '#0f3d5b', fontWeight: 600, boxShadow: 'none', border: 'none' },
                selected: { backgroundColor: 'transparent', color: '#0f3d5b', fontWeight: 600, boxShadow: 'none', border: 'none' },
                range_start: { backgroundColor: 'transparent', color: '#0f3d5b', fontWeight: 600, boxShadow: 'none', border: 'none' },
                range_middle: { backgroundColor: 'transparent', color: '#0f3d5b', fontWeight: 600, boxShadow: 'none', border: 'none' },
                range_end: { backgroundColor: 'transparent', color: '#0f3d5b', fontWeight: 600, boxShadow: 'none', border: 'none' },
                today: { backgroundColor: 'transparent', color: '#0f3d5b', fontWeight: 600, boxShadow: 'none', border: 'none' },
                outside: { color: '#64748b', opacity: 0.8, backgroundColor: 'rgba(226, 232, 240, 0.22)', boxShadow: 'inset 0 0 0 1px rgba(148, 163, 184, 0.12)' },
              }}
              components={{ DayButton: renderDayButton }}
              footer="Drag a highlighted booked date to move that booking to a new day."
            />
          </div>
        ) : viewMode === 'gantt' ? (
          <div style={{ display: 'grid', gap: '0.9rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.7rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#0f172a' }}>Person-based workload view</div>
                <div style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 700 }}>Assignments stay tied to each person while the timeline reflects the booking dates.</div>
              </div>
              <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.25rem 0.45rem', borderRadius: '0.6rem', border: '1px solid rgba(148,163,184,0.18)', background: '#ffffff' }}>
                  <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#334155' }}>Active installers</span>
                  <input type="number" min="1" max={Math.max(activeInstallers.length + inactiveInstallers.length, 1)} value={peopleCapacityTarget} onChange={(event) => setPeopleCapacityTarget(Number(event.target.value) || 1)} style={{ width: '3.2rem', border: 'none', outline: 'none', fontSize: '0.74rem', fontWeight: 700, color: '#0f172a', background: 'transparent' }} />
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.25rem 0.45rem', borderRadius: '0.6rem', border: '1px solid rgba(148,163,184,0.18)', background: '#ffffff' }}>
                  <input value={newInstallerName} onChange={(event) => setNewInstallerName(event.target.value)} placeholder="Add placeholder" style={{ border: 'none', outline: 'none', fontSize: '0.74rem', fontWeight: 700, color: '#0f172a', background: 'transparent', minWidth: '6.5rem' }} />
                  <button type="button" onClick={() => addInstallerToRoster(newInstallerName)} style={{ border: 'none', background: 'transparent', color: '#0f766e', fontWeight: 800, cursor: 'pointer', fontSize: '0.74rem' }}>Add</button>
                </div>
                <select value={timelineRange} onChange={(event) => setTimelineRange(event.target.value as 'next-2-weeks' | 'next-4-weeks' | 'next-3-months')} style={{ borderRadius: '0.6rem', border: '1px solid rgba(148,163,184,0.18)', background: '#ffffff', color: '#0f172a', padding: '0.3rem 0.45rem', fontWeight: 700, fontSize: '0.74rem' }}>
                  <option value="next-2-weeks">2 weeks</option>
                  <option value="next-4-weeks">4 weeks</option>
                  <option value="next-3-months">3 months</option>
                </select>
                <select value={ganttScale} onChange={(event) => setGanttScale(event.target.value as 'weekly' | 'monthly')} style={{ borderRadius: '0.6rem', border: '1px solid rgba(148,163,184,0.18)', background: '#ffffff', color: '#0f172a', padding: '0.3rem 0.45rem', fontWeight: 700, fontSize: '0.74rem' }}>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
            </div>
            <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'minmax(260px, 0.95fr) minmax(0, 1.4fr)' }}>
              <div style={{ padding: '0.75rem', borderRadius: '1rem', border: '1px solid rgba(148,163,184,0.16)', background: '#ffffff', boxShadow: '0 8px 24px rgba(15, 23, 42, 0.03)', display: 'grid', gap: '0.55rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem' }}>
                  <div style={{ fontSize: '0.9rem', fontWeight: 800, color: '#0f172a' }}>Installers</div>
                  <div style={{ fontSize: '0.74rem', fontWeight: 700, color: '#64748b' }}>{visiblePeople.length} installer{visiblePeople.length === 1 ? '' : 's'}</div>
                </div>
                <div style={{ display: 'grid', gap: '0.45rem' }}>
                  {visiblePeople.map((person) => {
                    const personAssignments = capacityAssignments.filter((assignment) => assignment.assignedPerson === person);
                    const isExpanded = expandedPerson === person;
                    return (
                      <div key={person} style={{ borderRadius: '0.9rem', border: '1px solid rgba(148,163,184,0.14)', background: '#f8fafc', overflow: 'hidden' }}>
                        <button
                          type="button"
                          onClick={() => setExpandedPerson(isExpanded ? null : person)}
                          onContextMenu={(event) => openInstallerContextMenu(event, person)}
                          style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 0.65rem', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left' }}
                        >
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.12rem' }}>
                            {editingInstallerName === person ? (
                              <input
                                autoFocus
                                value={installerNameDraft}
                                onChange={(event) => setInstallerNameDraft(event.target.value)}
                                onBlur={() => saveInstallerName(person)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    event.preventDefault();
                                    saveInstallerName(person);
                                  }
                                  if (event.key === 'Escape') {
                                    event.preventDefault();
                                    setEditingInstallerName(null);
                                    setInstallerNameDraft(installerNames[person] || person);
                                  }
                                }}
                                style={{ border: '1px solid rgba(148,163,184,0.3)', borderRadius: '0.5rem', padding: '0.25rem 0.4rem', fontSize: '0.78rem', fontWeight: 800, color: '#0f172a', minWidth: '4.5rem' }}
                              />
                            ) : (
                              <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#0f172a' }}>{installerNames[person] || person}</span>
                            )}
                          </div>
                          <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748b' }}>{personAssignments.length} assigned</div>
                        </button>
                        {installerContextMenu?.person === person && (
                          <div
                            onClick={(event) => event.stopPropagation()}
                            style={{ position: 'fixed', top: installerContextMenu.y, left: installerContextMenu.x, zIndex: 1000, borderRadius: '0.75rem', border: '1px solid rgba(148,163,184,0.2)', background: '#ffffff', boxShadow: '0 20px 45px rgba(15,23,42,0.16)', padding: '0.35rem', display: 'grid', gap: '0.25rem' }}
                          >
                            <button type="button" onClick={() => startEditingInstallerName(person)} style={{ border: 'none', borderRadius: '0.55rem', background: '#eff6ff', color: '#1d4ed8', padding: '0.4rem 0.55rem', fontSize: '0.72rem', fontWeight: 800, cursor: 'pointer', textAlign: 'left' }}>
                              Edit name
                            </button>
                            <button type="button" onClick={() => setInstallerContextMenu(null)} style={{ border: 'none', borderRadius: '0.55rem', background: '#f8fafc', color: '#475569', padding: '0.4rem 0.55rem', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', textAlign: 'left' }}>
                              Close
                            </button>
                          </div>
                        )}
                        {isExpanded && (
                          <div style={{ display: 'grid', gap: '0.35rem', padding: '0 0.65rem 0.65rem' }}>
                            {[...capacityAssignments]
                              .sort((left, right) => {
                                const leftTime = new Date(left.startDate).getTime();
                                const rightTime = new Date(right.startDate).getTime();
                                return leftTime - rightTime || `${left.clientName}-${left.location}`.localeCompare(`${right.clientName}-${right.location}`);
                              })
                              .map((assignment) => {
                                const isAssigned = assignment.assignedPerson === person;
                                const isAssignedElsewhere = Boolean(assignment.assignedPerson) && !isAssigned;
                                const rowStyle = isAssigned
                                  ? { background: '#eefbf4', border: '1px solid rgba(34,197,94,0.25)' }
                                  : isAssignedElsewhere
                                    ? { background: '#fff7ed', border: '1px solid rgba(249,115,22,0.28)' }
                                    : { background: '#ffffff', border: '1px solid rgba(148,163,184,0.12)' };
                                return (
                                  <label key={assignment.key} style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.45rem 0.5rem', borderRadius: '0.75rem', ...rowStyle, cursor: 'pointer' }}>
                                    <input
                                      type="checkbox"
                                      checked={isAssigned}
                                      onChange={() => {
                                        setInstallerAssignments((current) => {
                                          const next = { ...current };
                                          visiblePeople.forEach((installer) => {
                                            const currentAssignments = next[installer] || [];
                                            next[installer] = currentAssignments.filter((bookingId) => bookingId !== assignment.bookingId);
                                          });
                                          if (!isAssigned) {
                                            next[person] = [...(next[person] || []), assignment.bookingId];
                                          }
                                          return next;
                                        });
                                      }}
                                    />
                                    <div style={{ display: 'grid', gap: '0.12rem', flex: 1 }}>
                                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.4rem' }}>
                                        <span style={{ fontSize: '0.72rem', fontWeight: 800, color: '#0f172a' }}>{assignment.clientName} • {assignment.location}</span>
                                        <span style={{ fontSize: '0.58rem', fontWeight: 800, padding: '0.16rem 0.38rem', borderRadius: '999px', background: isAssigned ? '#dcfce7' : isAssignedElsewhere ? '#ffedd5' : '#f1f5f9', color: isAssigned ? '#166534' : isAssignedElsewhere ? '#9a2c00' : '#475569' }}>
                                          {isAssigned ? 'Assigned' : isAssignedElsewhere ? 'Taken' : 'Open'}
                                        </span>
                                      </div>
                                      <span style={{ fontSize: '0.64rem', fontWeight: 700, color: '#64748b' }}>{format(new Date(assignment.startDate), 'MMM d')} → {format(new Date(assignment.endDate), 'MMM d')}</span>
                                      {isAssignedElsewhere && (
                                        <span style={{ fontSize: '0.6rem', fontWeight: 700, color: '#c2410c' }}>Already assigned to {assignment.assignedPerson}</span>
                                      )}
                                    </div>
                                  </label>
                                );
                              })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div style={{ padding: '0.75rem', borderRadius: '1rem', border: '1px solid rgba(148,163,184,0.16)', background: '#ffffff', boxShadow: '0 8px 24px rgba(15, 23, 42, 0.03)', display: 'grid', gap: '0.6rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem' }}>
                  <div style={{ fontSize: '0.9rem', fontWeight: 800, color: '#0f172a' }}>Timeline</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <span style={{ fontSize: '0.68rem', fontWeight: 800, color: '#64748b', marginRight: '0.1rem' }}>Zoom</span>
                    <button type="button" onClick={() => zoomGanttChart('out')} style={{ border: '1px solid rgba(148,163,184,0.2)', borderRadius: '0.55rem', background: '#ffffff', color: '#0f172a', padding: '0.25rem 0.45rem', fontSize: '0.72rem', fontWeight: 800, cursor: 'pointer' }}>−</button>
                    <button type="button" onClick={() => zoomGanttChart('in')} style={{ border: '1px solid rgba(148,163,184,0.2)', borderRadius: '0.55rem', background: '#ffffff', color: '#0f172a', padding: '0.25rem 0.45rem', fontSize: '0.72rem', fontWeight: 800, cursor: 'pointer' }}>+</button>
                  </div>
                </div>
                <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b' }}>Drag to move • right-click to revert</div>
                <div ref={ganttTrackRef} onMouseEnter={() => setGanttChartHovered(true)} onMouseLeave={() => setGanttChartHovered(false)} onContextMenu={handleGanttContextMenu} onWheelCapture={handleGanttWheelZoom} onWheel={handleGanttWheelZoom} style={{ display: 'grid', gap: '0.5rem', cursor: 'zoom-in' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, timelineBuckets.length)}, minmax(0, 1fr))`, gap: '0.25rem' }}>
                    {timelineBuckets.map((bucket) => (
                      <div key={bucket.key} style={{ minHeight: '38px', padding: '0.2rem', borderRadius: '0.75rem', border: '1px solid rgba(148,163,184,0.12)', background: '#f8fafc', color: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
                        <span style={{ fontSize: '0.72rem', fontWeight: 800 }}>{bucket.shortLabel}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'grid', gap: '0.55rem' }}>
                    {personAssignmentRows.map(({ person, assignments }) => {
                      return (
                        <div key={person} style={{ display: 'grid', gap: '0.3rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.35rem' }}>
                            {editingInstallerName === person ? (
                              <input
                                autoFocus
                                value={installerNameDraft}
                                onChange={(event) => setInstallerNameDraft(event.target.value)}
                                onBlur={() => saveInstallerName(person)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    event.preventDefault();
                                    saveInstallerName(person);
                                  }
                                  if (event.key === 'Escape') {
                                    event.preventDefault();
                                    setEditingInstallerName(null);
                                    setInstallerNameDraft(installerNames[person] || person);
                                  }
                                }}
                                style={{ border: '1px solid rgba(148,163,184,0.3)', borderRadius: '0.5rem', padding: '0.25rem 0.4rem', fontSize: '0.74rem', fontWeight: 800, color: '#0f172a', minWidth: '4.5rem' }}
                              />
                            ) : (
                              <div onContextMenu={(event) => openInstallerContextMenu(event, person)} style={{ cursor: 'context-menu' }}>
                                <span style={{ fontSize: '0.74rem', fontWeight: 800, color: '#0f172a' }}>{installerNames[person] || person}</span>
                              </div>
                            )}
                          </div>
                          {installerContextMenu?.person === person && (
                            <div
                              onClick={(event) => event.stopPropagation()}
                              style={{ position: 'fixed', top: installerContextMenu.y, left: installerContextMenu.x, zIndex: 1000, borderRadius: '0.75rem', border: '1px solid rgba(148,163,184,0.2)', background: '#ffffff', boxShadow: '0 20px 45px rgba(15,23,42,0.16)', padding: '0.35rem', display: 'grid', gap: '0.25rem' }}
                            >
                              <button type="button" onClick={() => startEditingInstallerName(person)} style={{ border: 'none', borderRadius: '0.55rem', background: '#eff6ff', color: '#1d4ed8', padding: '0.4rem 0.55rem', fontSize: '0.72rem', fontWeight: 800, cursor: 'pointer', textAlign: 'left' }}>
                                Edit name
                              </button>
                              <button type="button" onClick={() => setInstallerContextMenu(null)} style={{ border: 'none', borderRadius: '0.55rem', background: '#f8fafc', color: '#475569', padding: '0.4rem 0.55rem', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', textAlign: 'left' }}>
                                Close
                              </button>
                            </div>
                          )}
                          <div style={{ position: 'relative', height: '44px', borderRadius: '0.9rem', background: 'linear-gradient(180deg, #f8fafc 0%, #eef2f7 100%)', border: '1px solid rgba(148,163,184,0.16)', overflow: 'hidden', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.7)' }}>
                            <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, timelineBuckets.length)}, minmax(0, 1fr))`, gap: '1px' }}>
                              {timelineBuckets.map((bucket) => (
                                <div key={`${person}-${bucket.key}`} style={{ borderRight: '1px solid rgba(148,163,184,0.12)', background: 'transparent' }} />
                              ))}
                            </div>
                            {assignments.map((assignment) => {
                              const booking = bookings.find((item) => item.id === assignment.bookingId);
                              const start = new Date(assignment.startDate);
                              const end = new Date(assignment.endDate);
                              const totalDays = Math.max(1, differenceInDays(ganttRange.end, ganttRange.start) + 1);
                              const startOffset = Math.max(0, differenceInDays(start, ganttRange.start));
                              const widthDays = Math.max(1, differenceInDays(end, start) + 1);
                              const leftOffset = (startOffset / totalDays) * 100;
                              const width = Math.max(16, Math.min(100, (widthDays / totalDays) * 100));
                              return (
                                <div
                                  key={assignment.bookingId}
                                  onMouseDown={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    setSelectedBookingId(assignment.bookingId);
                                    setGanttDragState({ bookingId: assignment.bookingId, mode: 'move', startX: event.clientX, initialStart: start, initialEnd: end });
                                    setGanttPreviewStart(start);
                                    setGanttPreviewEnd(end);
                                  }}
                                  style={{ position: 'absolute', left: `${leftOffset}%`, width: `${Math.min(width, 100)}%`, height: '100%', borderRadius: '0.8rem', background: `linear-gradient(135deg, ${booking ? getBookingColor(booking) : '#2563eb'} 0%, ${booking ? getBookingColor(booking) : '#2563eb'}CC 100%)`, cursor: 'grab', border: selectedBookingId === assignment.bookingId ? '2px solid #f59e0b' : '1px solid rgba(255,255,255,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '0.72rem', fontWeight: 800, padding: '0 0.45rem', boxShadow: selectedBookingId === assignment.bookingId ? '0 0 0 3px rgba(245,158,11,0.18)' : '0 10px 20px rgba(15,23,42,0.18)', minHeight: '36px', zIndex: 2 }}
                                >
                                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{booking ? `${booking.clientName} • ${booking.location}` : 'Assignment'}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '0.9rem' }}>
            <div style={{ display: 'grid', gap: '0.55rem', padding: '0.9rem', borderRadius: '1rem', border: '1px solid rgba(148,163,184,0.16)', background: 'rgba(248,250,252,0.8)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: '1rem', fontWeight: 800, color: '#0f172a' }}>Workload planner</div>
                  <div style={{ fontSize: '0.82rem', color: '#475569', lineHeight: 1.45, marginTop: '0.2rem' }}>Each month starts with 160 office hours. Each assignment in that month removes one office week (40 hours), adds 60 assignment hours, and adds 32 travel hours.</div>
                </div>
                <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.25rem 0.45rem', borderRadius: '0.6rem', border: '1px solid rgba(148,163,184,0.18)', background: '#ffffff' }}>
                    <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#334155' }}>Active installers</span>
                    <input type="number" min="1" max={Math.max(activeInstallers.length + inactiveInstallers.length, 1)} value={peopleCapacityTarget} onChange={(event) => setPeopleCapacityTarget(Number(event.target.value) || 1)} style={{ width: '3.2rem', border: 'none', outline: 'none', fontSize: '0.74rem', fontWeight: 700, color: '#0f172a', background: 'transparent' }} />
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.25rem 0.45rem', borderRadius: '0.6rem', border: '1px solid rgba(148,163,184,0.18)', background: '#ffffff' }}>
                    <input value={newInstallerName} onChange={(event) => setNewInstallerName(event.target.value)} placeholder="Add placeholder" style={{ border: 'none', outline: 'none', fontSize: '0.74rem', fontWeight: 700, color: '#0f172a', background: 'transparent', minWidth: '6.5rem' }} />
                    <button type="button" onClick={() => addInstallerToRoster(newInstallerName)} style={{ border: 'none', background: 'transparent', color: '#0f766e', fontWeight: 800, cursor: 'pointer', fontSize: '0.74rem' }}>Add</button>
                  </div>
                </div>
              </div>
              <div style={{ display: 'grid', gap: '0.45rem' }}>
                {workloadRows.map((row) => {
                  const cardBackground = row.status === 'Overloaded'
                    ? '#fef2f2'
                    : row.status === 'Near capacity'
                      ? '#fff7ed'
                      : '#f8fafc';
                  return (
                    <div key={row.person} style={{ borderRadius: '0.9rem', border: '1px solid rgba(148,163,184,0.14)', background: cardBackground, padding: '0.65rem 0.7rem', display: 'grid', gap: '0.35rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                        <div style={{ fontSize: '0.82rem', fontWeight: 800, color: '#0f172a' }}>{installerNames[row.person] || row.person}</div>
                        <span style={{ fontSize: '0.66rem', fontWeight: 800, padding: '0.2rem 0.4rem', borderRadius: '999px', background: row.status === 'Overloaded' ? '#fecaca' : row.status === 'Near capacity' ? '#fed7aa' : '#dbeafe', color: row.status === 'Overloaded' ? '#b91c1c' : row.status === 'Near capacity' ? '#9a2c00' : '#1d4ed8' }}>
                          {row.status}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569' }}>{row.assignments.length} assignment{row.assignments.length === 1 ? '' : 's'} • {row.totalWorkloadDays.toFixed(1)} effective days</span>
                        <span style={{ fontSize: '0.72rem', fontWeight: 800, color: '#0f172a' }}>{row.totalWorkloadHours} hours</span>
                      </div>
                      <div style={{ display: 'grid', gap: '0.25rem' }}>
                        {row.assignments.map((assignment) => (
                          <div key={assignment.bookingId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', fontSize: '0.7rem', color: '#334155' }}>
                            <span>{assignment.clientName} • {assignment.location}</span>
                            <span>{assignment.assignmentDays} day{assignment.assignmentDays === 1 ? '' : 's'} + {assignment.travelDays} travel = {assignment.workloadHours}h</span>
                          </div>
                        ))}
                      </div>
                      <div style={{ display: 'grid', gap: '0.3rem' }}>
                        <div style={{ fontSize: '0.68rem', fontWeight: 800, color: '#64748b' }}>Monthly breakdown</div>
                        <div style={{ display: 'grid', gap: '0.25rem' }}>
                          {row.monthlyBreakdown.map((bucket) => (
                            <div key={`${row.person}-${bucket.month}`} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '0.45rem', alignItems: 'center', padding: '0.35rem 0.45rem', borderRadius: '0.65rem', background: '#ffffff', border: '1px solid rgba(148,163,184,0.16)' }}>
                              <span style={{ fontSize: '0.68rem', fontWeight: 800, color: '#0f172a' }}>{bucket.month}</span>
                              <span style={{ fontSize: '0.67rem', color: '#475569' }}>Office {bucket.officeHours}h • Assignment {bucket.assignmentHours}h • Travel {bucket.travelHours}h</span>
                              <span style={{ fontSize: '0.68rem', fontWeight: 800, color: '#2563eb' }}>{bucket.totalHours}h</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b' }}>Staffing target: {row.staffingNeed} person{row.staffingNeed === 1 ? '' : 's'} for this workload.</div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div style={{ border: '1px solid rgba(148,163,184,0.16)', borderRadius: '1rem', background: '#ffffff', boxShadow: '0 8px 24px rgba(15, 23, 42, 0.03)', padding: '0.8rem 0.9rem', display: 'grid', gap: '0.45rem' }}>
              <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#0f172a' }}>Monthly workload formula</div>
              <div style={{ fontSize: '0.8rem', color: '#475569', lineHeight: 1.5 }}>Monthly workload is based on the number of assignments a person has in that month: office hours drop as assignments increase, while assignment and travel hours rise for each assignment.</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#1d4ed8' }}>Current staffing need: {staffingSummary.recommendedStaff} person{staffingSummary.recommendedStaff === 1 ? '' : 's'}</span>
                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: staffingSummary.isUnderstaffed ? '#b91c1c' : '#0f766e' }}>{staffingSummary.totalAssignments} assignment{staffingSummary.totalAssignments === 1 ? '' : 's'} • {staffingSummary.totalWorkloadHours} total hours</span>
              </div>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: staffingSummary.staffGap > 0 ? '#b91c1c' : '#0f766e' }}>
                {staffingSummary.staffGap > 0
                  ? `Add ${staffingSummary.staffGap} more ${staffingSummary.staffGap === 1 ? 'person' : 'people'} to stay within the monthly limit.`
                  : 'Current staffing is sufficient for the live monthly workload.'}
              </div>
              <div style={{ display: 'grid', gap: '0.35rem' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', fontSize: '0.72rem', color: '#475569' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.2rem 0.45rem', borderRadius: '999px', background: '#dbeafe', color: '#1d4ed8', fontWeight: 700 }}>Healthy: up to 120h</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.2rem 0.45rem', borderRadius: '999px', background: '#fed7aa', color: '#9a2c00', fontWeight: 700 }}>Near capacity: 121–160h</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.2rem 0.45rem', borderRadius: '999px', background: '#fecaca', color: '#b91c1c', fontWeight: 700 }}>Overbooked: 161–179h</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.2rem 0.45rem', borderRadius: '999px', background: '#fef2f2', color: '#991b1b', fontWeight: 700 }}>Critical overload: 180h+</span>
                </div>
                <div style={{ fontSize: '0.72rem', color: '#64748b' }}>Bands are shown as 10-hour ranges such as 101–110, 111–120, 121–130, and so on.</div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', color: '#334155' }}>
                      <th style={{ textAlign: 'left', padding: '0.45rem 0.5rem', borderBottom: '1px solid rgba(148,163,184,0.16)' }}>Person</th>
                      <th style={{ textAlign: 'left', padding: '0.45rem 0.5rem', borderBottom: '1px solid rgba(148,163,184,0.16)' }}>Monthly hours</th>
                      <th style={{ textAlign: 'left', padding: '0.45rem 0.5rem', borderBottom: '1px solid rgba(148,163,184,0.16)' }}>Capacity band</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workloadRows.map((row) => {
                      const { bandStart, bandEnd, status } = getCapacityBand(row.totalWorkloadHours);
                      return (
                        <tr key={row.person} style={{ borderBottom: '1px solid rgba(148,163,184,0.12)' }}>
                          <td style={{ padding: '0.45rem 0.5rem', fontWeight: 700, color: '#0f172a' }}>{installerNames[row.person] || row.person}</td>
                          <td style={{ padding: '0.45rem 0.5rem', fontWeight: 700, color: '#1d4ed8' }}>{row.totalWorkloadHours}h</td>
                          <td style={{ padding: '0.45rem 0.5rem', fontWeight: 700, color: row.totalWorkloadHours >= criticalThresholdHours ? '#991b1b' : row.totalWorkloadHours >= overloadThresholdHours ? '#b91c1c' : row.totalWorkloadHours >= nearCapacityThresholdHours ? '#9a2c00' : '#0f766e' }}>
                            {bandStart}-{bandEnd}h • {status}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
      {ganttContextMenu && (
        <div
          onClick={(event) => event.stopPropagation()}
          style={{ position: 'fixed', top: ganttContextMenu.y, left: ganttContextMenu.x, zIndex: 1100, borderRadius: '0.75rem', border: '1px solid rgba(148,163,184,0.2)', background: '#ffffff', boxShadow: '0 20px 45px rgba(15,23,42,0.16)', padding: '0.35rem', display: 'grid', gap: '0.25rem' }}
        >
          <button type="button" onClick={revertGanttMove} style={{ border: 'none', borderRadius: '0.55rem', background: '#eff6ff', color: '#1d4ed8', padding: '0.4rem 0.55rem', fontSize: '0.72rem', fontWeight: 800, cursor: 'pointer', textAlign: 'left' }}>
            Revert to previous
          </button>
          <button type="button" onClick={revertGanttMoveToOriginal} style={{ border: 'none', borderRadius: '0.55rem', background: '#fef2f2', color: '#b91c1c', padding: '0.4rem 0.55rem', fontSize: '0.72rem', fontWeight: 800, cursor: 'pointer', textAlign: 'left' }}>
            Revert to original
          </button>
          <button type="button" onClick={() => setGanttContextMenu(null)} style={{ border: 'none', borderRadius: '0.55rem', background: '#f8fafc', color: '#475569', padding: '0.4rem 0.55rem', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', textAlign: 'left' }}>
            Close
          </button>
        </div>
      )}
      <p style={{ marginTop: '0.2rem', fontSize: '0.95rem', color: '#334155' }}>{summary}</p>
      {result && (
        <p
          style={{
            marginTop: '0.2rem',
            fontSize: '0.95rem',
            color: result.success ? '#0f766e' : '#dc2626',
            fontWeight: 600,
          }}
        >
          {result.message}
        </p>
      )}
      {bookings.length > 0 && (
        <p style={{ marginTop: '0.2rem', fontSize: '0.95rem', color: '#475569' }}>
          Double-click a booking to edit its details. Drag a highlighted booking to move it.
        </p>
      )}
    </div>
  );
}

export default CohortPicker;
