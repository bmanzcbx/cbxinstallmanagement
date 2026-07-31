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

async function createCalBookingLink({ territory, product, areaManager, assignedTech, zip }) {
  const calApiKey = process.env.CAL_COM_API_KEY;
  if (!calApiKey) {
    throw new Error('Missing CAL_COM_API_KEY environment variable. Add it in your deployment environment settings.');
  }

  const calApiBaseUrl = normalizeBaseUrl(process.env.CAL_COM_API_BASE_URL, 'https://api.cal.com');
  const createEventTypePath = String(process.env.CAL_COM_EVENT_TYPES_PATH || '/v2/event-types').trim();
  const endpoint = `${calApiBaseUrl}${createEventTypePath.startsWith('/') ? createEventTypePath : `/${createEventTypePath}`}`;

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

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${calApiKey}`,
    },
    body: JSON.stringify(requestPayload),
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

  const targetTerritory = mapZipToOperationalTerritory(zip);

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

module.exports = {
  employeesDB,
  mapZipToOperationalTerritory,
  evaluateManagerCapacity,
  generateIntelligentSetupLink,
};
