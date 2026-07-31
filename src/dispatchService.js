const employeesDB = [
  { id: 'usr_mgr_chi_1', name: 'Sarah (Manager)', role: 'Area Manager', territory: 'IL-CHICAGO', calUserId: 101 },
  { id: 'usr_tech_chi_1', name: 'Alex (Tech)', role: 'Setup Specialist', territory: 'IL-CHICAGO', calUserId: 201 },
  { id: 'usr_tech_chi_2', name: 'Ben (Tech)', role: 'Setup Specialist', territory: 'IL-CHICAGO', calUserId: 202 },
  { id: 'usr_mgr_nyc_1', name: 'John (Manager)', role: 'Area Manager', territory: 'NY-MANHATTAN', calUserId: 102 },
];

const territoryRoundRobinIndex = new Map();

function mapZipToOperationalTerritory(zip) {
  const normalizedZip = String(zip || '').trim();
  if (normalizedZip.startsWith('606')) return 'IL-CHICAGO';
  if (normalizedZip.startsWith('100')) return 'NY-MANHATTAN';
  return 'US-STANDARD-BACKLOG';
}

function evaluateManagerCapacity(managerId, bookings = []) {
  const managerAssignments = bookings.filter((booking) => String(booking.assignedManagerId || '') === String(managerId));
  const totalBookedHoursThisWeek = managerAssignments.length * 2;
  const maxCapacityLimit = 40;
  const utilizationPercentage = (totalBookedHoursThisWeek / maxCapacityLimit) * 100;

  return {
    totalBookedHoursThisWeek,
    maxCapacityLimit,
    utilizationPercentage,
    warning: utilizationPercentage >= 80
      ? `Area Manager [${managerId}] is at ${utilizationPercentage.toFixed(1)}% capacity.`
      : null,
  };
}

function pickTechnicianForTerritory(territory, setupTechs) {
  if (!setupTechs.length) {
    return null;
  }

  const current = territoryRoundRobinIndex.get(territory) || 0;
  const next = setupTechs[current % setupTechs.length];
  territoryRoundRobinIndex.set(territory, (current + 1) % setupTechs.length);
  return next;
}

function normalizeBaseUrl(value, fallback) {
  const base = String(value || fallback || '').trim();
  return base.replace(/\/+$/, '');
}

function getCalConfig() {
  const calApiKey = process.env.CAL_COM_API_KEY;
  if (!calApiKey) {
    throw new Error('Missing CAL_COM_API_KEY environment variable. Add it in your deployment environment settings.');
  }

  const baseUrl = normalizeBaseUrl(process.env.CAL_COM_API_BASE_URL, 'https://api.cal.com');
  const eventTypesPath = String(process.env.CAL_COM_EVENT_TYPES_PATH || '/v2/event-types').trim();
  const bookingsPath = String(process.env.CAL_COM_BOOKINGS_PATH || '/v2/bookings').trim();
  const defaultTimeZone = String(process.env.CAL_COM_TIMEZONE || 'America/Chicago').trim();
  const defaultLanguage = String(process.env.CAL_COM_LANGUAGE || 'en').trim();
  const defaultAttendeeName = String(process.env.CAL_COM_DEFAULT_ATTENDEE_NAME || 'Dispatch Client').trim();
  const defaultAttendeeEmail = String(process.env.CAL_COM_DEFAULT_ATTENDEE_EMAIL || 'dispatch@example.com').trim();
  const configuredEventTypeIdRaw = String(process.env.CAL_COM_EVENT_TYPE_ID || '').trim();
  const configuredEventTypeId = configuredEventTypeIdRaw ? Number(configuredEventTypeIdRaw) : null;

  return {
    calApiKey,
    baseUrl,
    eventTypesPath: eventTypesPath.startsWith('/') ? eventTypesPath : `/${eventTypesPath}`,
    bookingsPath: bookingsPath.startsWith('/') ? bookingsPath : `/${bookingsPath}`,
    defaultTimeZone,
    defaultLanguage,
    defaultAttendeeName,
    defaultAttendeeEmail,
    configuredEventTypeId: Number.isFinite(configuredEventTypeId) ? configuredEventTypeId : null,
  };
}

async function requestCal(config, path, options = {}) {
  const endpoint = `${config.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;

  const response = await fetch(endpoint, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.calApiKey}`,
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const rawBody = await response.text();
  let body = {};
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch (error) {
    body = { rawBody };
  }

  if (!response.ok) {
    throw new Error(`Cal.com request failed (${response.status}): ${rawBody || response.statusText}`);
  }

  return body;
}

function createDateAtUtcHour(date, hour) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour, 0, 0, 0));
}

function createProjectDayDates(startDateStr, totalDays) {
  const startDate = new Date(startDateStr);
  if (Number.isNaN(startDate.getTime())) {
    throw new Error('Invalid start date. Use YYYY-MM-DD.');
  }

  const days = [];
  for (let offset = 0; offset < totalDays; offset += 1) {
    const currentDate = new Date(startDate);
    currentDate.setUTCDate(currentDate.getUTCDate() + offset);

    // Skip Saturday and Sunday for field operations.
    if (currentDate.getUTCDay() === 0 || currentDate.getUTCDay() === 6) {
      continue;
    }

    days.push(currentDate);
  }

  if (!days.length) {
    throw new Error('No working days found in the selected range.');
  }

  return days;
}

function extractBookingId(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  return value.id
    || value.uid
    || value.bookingId
    || value.data?.id
    || value.data?.uid
    || null;
}

function extractBookingUrl(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  return value.bookingUrl
    || value.url
    || value.data?.bookingUrl
    || value.data?.url
    || value.data?.metadata?.bookingUrl
    || null;
}

function extractEventTypeId(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value?.eventType?.id
    || value?.data?.eventType?.id
    || value?.data?.id
    || value?.id
    || null;

  if (candidate === null || candidate === undefined) {
    return null;
  }

  const numeric = Number(candidate);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeCalMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const normalized = {};
  for (const [key, raw] of Object.entries(value)) {
    if (raw === null || raw === undefined) {
      normalized[key] = '';
    } else if (typeof raw === 'string') {
      normalized[key] = raw;
    } else if (typeof raw === 'number' || typeof raw === 'boolean' || typeof raw === 'bigint') {
      normalized[key] = String(raw);
    } else {
      normalized[key] = JSON.stringify(raw);
    }
  }

  return normalized;
}

function resolveDispatchTeam(clientZipCode, bookings = []) {
  const targetTerritory = mapZipToOperationalTerritory(clientZipCode);
  const areaManager = employeesDB.find((emp) => emp.territory === targetTerritory && emp.role === 'Area Manager');
  const setupTechs = employeesDB.filter((emp) => emp.territory === targetTerritory && emp.role === 'Setup Specialist');

  if (!areaManager || !setupTechs.length) {
    throw new Error(`No field coverage established for territory: ${targetTerritory}`);
  }

  const capacity = evaluateManagerCapacity(areaManager.id, bookings);
  const assignedTech = pickTechnicianForTerritory(targetTerritory, setupTechs);

  if (!assignedTech) {
    throw new Error(`No setup specialist available for territory: ${targetTerritory}`);
  }

  return {
    territory: targetTerritory,
    areaManager,
    assignedTech,
    capacity,
  };
}

async function createCalBookingLink({ territory, product, areaManager, assignedTech, zip }) {
  const config = getCalConfig();

  const requestPayload = {
    title: `Product Setup: ${product} Installation`,
    slug: `setup-${zip}-${Date.now()}`,
    length: 120,
    schedulingType: 'COLLECTIVE',
    userIds: [areaManager.calUserId, assignedTech.calUserId],
    metadata: {
      territory,
      assignedManagerId: areaManager.id,
      assignedTechId: assignedTech.id,
    },
  };

  const body = await requestCal(config, config.eventTypesPath, {
    method: 'POST',
    body: requestPayload,
  });

  const bookingUrl = body?.bookingUrl
    || body?.data?.bookingUrl
    || body?.eventType?.bookingUrl
    || body?.data?.eventType?.bookingUrl
    || (body?.eventType?.slug ? `https://cal.com/${body.eventType.slug}` : null)
    || (body?.data?.eventType?.slug ? `https://cal.com/${body.data.eventType.slug}` : null);

  const resolvedBookingUrl = bookingUrl || `https://cal.com/${requestPayload.slug}`;

  return {
    bookingUrl: resolvedBookingUrl,
    calResponse: body,
    eventTypeId: extractEventTypeId(body),
    slug: requestPayload.slug,
  };
}

async function createSingleCalBooking(config, payload) {
  const payloadVariants = [
    payload,
    { booking: payload },
    { ...payload, booking: payload },
  ];

  let body = null;
  let lastError = null;

  for (let index = 0; index < payloadVariants.length; index += 1) {
    const candidateBody = payloadVariants[index];
    try {
      body = await requestCal(config, config.bookingsPath, {
        method: 'POST',
        body: candidateBody,
      });
      break;
    } catch (error) {
      lastError = error;
      const message = String(error?.message || '');
      const shouldRetry = message.includes('invalid_type') || message.includes('Required') || message.includes('BadRequestException');
      if (!shouldRetry || index === payloadVariants.length - 1) {
        throw error;
      }
    }
  }

  if (!body) {
    throw lastError || new Error('Cal.com booking request failed.');
  }

  const bookingId = extractBookingId(body);
  const bookingUrl = extractBookingUrl(body);

  return {
    bookingId,
    bookingUrl,
    responseBody: body,
  };
}

async function cancelCalBooking(config, bookingId) {
  if (!bookingId) {
    return;
  }

  const path = `${config.bookingsPath}/${encodeURIComponent(String(bookingId))}`;
  try {
    await requestCal(config, path, { method: 'DELETE' });
  } catch (error) {
    // Ignore rollback failures; we still want the original error to bubble up.
  }
}

async function bookMultiDayProject(startDateStr, totalDays, teamUserIds, metadata = {}, options = {}) {
  const parsedTotalDays = Number(totalDays);
  if (!Number.isInteger(parsedTotalDays) || parsedTotalDays < 1 || parsedTotalDays > 30) {
    throw new Error('totalDays must be an integer between 1 and 30.');
  }

  if (!Array.isArray(teamUserIds) || teamUserIds.length < 2) {
    throw new Error('At least two Cal user IDs are required for collective booking.');
  }

  const config = getCalConfig();
  const eventTypeIdRaw = options.eventTypeId ?? config.configuredEventTypeId;
  if (eventTypeIdRaw === null || eventTypeIdRaw === undefined || eventTypeIdRaw === '') {
    throw new Error('Cal eventTypeId is required for multi-day booking. Set CAL_COM_EVENT_TYPE_ID or allow auto-created event types.');
  }

  const eventTypeIdCandidate = Number(eventTypeIdRaw);
  if (!Number.isFinite(eventTypeIdCandidate) || eventTypeIdCandidate <= 0) {
    throw new Error('Cal eventTypeId is required for multi-day booking. Set CAL_COM_EVENT_TYPE_ID or allow auto-created event types.');
  }

  const timeZone = String(options.timeZone || config.defaultTimeZone || '').trim();
  const language = String(options.language || config.defaultLanguage || '').trim();
  const attendeeName = String(options.attendee?.name || config.defaultAttendeeName || '').trim();
  const attendeeEmail = String(options.attendee?.email || config.defaultAttendeeEmail || '').trim();
  if (!timeZone) {
    throw new Error('Cal time zone is required. Set CAL_COM_TIMEZONE.');
  }
  if (!language) {
    throw new Error('Cal language is required. Set CAL_COM_LANGUAGE.');
  }
  if (!attendeeName) {
    throw new Error('Cal attendee name is required. Set CAL_COM_DEFAULT_ATTENDEE_NAME.');
  }
  if (!attendeeEmail || !attendeeEmail.includes('@')) {
    throw new Error('Cal attendee email is required. Set CAL_COM_DEFAULT_ATTENDEE_EMAIL to a valid email.');
  }

  const projectDates = createProjectDayDates(startDateStr, parsedTotalDays);
  const baseMetadata = normalizeCalMetadata(metadata);
  const createdBookings = [];

  try {
    for (let dayIndex = 0; dayIndex < projectDates.length; dayIndex += 1) {
      const currentDate = projectDates[dayIndex];
      const dayStart = createDateAtUtcHour(currentDate, 9);

      const bookingPayload = {
        eventTypeId: eventTypeIdCandidate,
        timeZone,
        language,
        start: dayStart.toISOString(),
        userIds: teamUserIds,
        attendee: {
          name: attendeeName,
          email: attendeeEmail,
          timeZone,
          language,
        },
        responses: {
          name: attendeeName,
          email: attendeeEmail,
          guests: [],
          location: {
            optionValue: '',
            value: '',
          },
        },
        title: `Day ${dayIndex + 1}/${projectDates.length}: Nationwide Product Setup`,
        description: 'On-site multi-day deployment and localized system onboarding.',
        metadata: {
          ...baseMetadata,
          sequence: String(dayIndex + 1),
          totalWorkingDays: String(projectDates.length),
        },
      };

      const created = await createSingleCalBooking(config, bookingPayload);
      createdBookings.push({
        bookingId: created.bookingId,
        bookingUrl: created.bookingUrl,
        day: dayStart.toISOString().slice(0, 10),
        raw: created.responseBody,
      });
    }
  } catch (error) {
    await Promise.all(createdBookings.map((entry) => cancelCalBooking(config, entry.bookingId)));
    throw error;
  }

  return {
    success: true,
    eventTypeId: eventTypeIdCandidate,
    timeZone,
    language,
    totalRequestedDays: parsedTotalDays,
    totalWorkingDays: projectDates.length,
    activeBlockIds: createdBookings.map((entry) => entry.bookingId).filter(Boolean),
    bookingUrls: createdBookings.map((entry) => entry.bookingUrl).filter(Boolean),
    scheduledDays: createdBookings.map((entry) => entry.day),
  };
}

async function generateIntelligentSetupLink(clientZipCode, clientProduct, options = {}) {
  const zip = String(clientZipCode || '').trim();
  const product = String(clientProduct || '').trim();
  const bookings = Array.isArray(options.bookings) ? options.bookings : [];

  if (!zip) {
    throw new Error('ZIP code is required.');
  }

  if (!product) {
    throw new Error('Product type is required.');
  }

  const dispatchTeam = resolveDispatchTeam(zip, bookings);
  const { territory: targetTerritory, areaManager, assignedTech, capacity } = dispatchTeam;

  const calResult = await createCalBookingLink({
    territory: targetTerritory,
    product,
    areaManager,
    assignedTech,
    zip,
  });

  return {
    success: true,
    territory: targetTerritory,
    bookingUrl: calResult.bookingUrl,
    assignedTeam: {
      manager: areaManager.name,
      technician: assignedTech.name,
      managerId: areaManager.id,
      technicianId: assignedTech.id,
    },
    capacity,
  };
}

async function reserveMultiDayProjectDispatch(input = {}, options = {}) {
  const zip = String(input.zip || '').trim();
  const product = String(input.product || '').trim();
  const startDate = String(input.startDate || '').trim();
  const totalDays = Number(input.totalDays || 0);
  const clientName = String(input.clientName || '').trim();
  const clientEmail = String(input.clientEmail || '').trim();
  const bookings = Array.isArray(options.bookings) ? options.bookings : [];

  if (!zip) {
    throw new Error('ZIP code is required.');
  }
  if (!product) {
    throw new Error('Product type is required.');
  }
  if (!startDate) {
    throw new Error('Project start date is required.');
  }

  const dispatchTeam = resolveDispatchTeam(zip, bookings);
  const { territory, areaManager, assignedTech, capacity } = dispatchTeam;

  const config = getCalConfig();
  let eventTypeId = config.configuredEventTypeId;
  let eventTypeSlug = null;

  if (!eventTypeId) {
    const eventTypeSetup = await createCalBookingLink({
      territory,
      product,
      areaManager,
      assignedTech,
      zip,
    });
    eventTypeId = eventTypeSetup.eventTypeId;
    eventTypeSlug = eventTypeSetup.slug;
  }

  if (!Number.isFinite(Number(eventTypeId))) {
    throw new Error('Unable to resolve Cal eventTypeId for multi-day booking. Set CAL_COM_EVENT_TYPE_ID in environment.');
  }

  const bookingResult = await bookMultiDayProject(
    startDate,
    totalDays,
    [areaManager.calUserId, assignedTech.calUserId],
    {
      territory,
      product,
      assignedManagerId: areaManager.id,
      assignedTechId: assignedTech.id,
      startDate,
      totalDays,
    }
    , {
      eventTypeId,
      timeZone: config.defaultTimeZone,
      language: config.defaultLanguage,
      attendee: {
        name: clientName || config.defaultAttendeeName,
        email: clientEmail || config.defaultAttendeeEmail,
      },
    }
  );

  return {
    success: true,
    territory,
    eventTypeId,
    eventTypeSlug,
    assignedTeam: {
      manager: areaManager.name,
      technician: assignedTech.name,
      managerId: areaManager.id,
      technicianId: assignedTech.id,
    },
    capacity,
    ...bookingResult,
  };
}

module.exports = {
  employeesDB,
  mapZipToOperationalTerritory,
  evaluateManagerCapacity,
  generateIntelligentSetupLink,
  bookMultiDayProject,
  reserveMultiDayProjectDispatch,
};
