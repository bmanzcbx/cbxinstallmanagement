const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dataDirectory = process.env.LINEAR_SYNC_DATA_DIR
  ? path.resolve(process.env.LINEAR_SYNC_DATA_DIR)
  : path.join(__dirname, '..', '.data');
const configFilePath = path.join(dataDirectory, 'linear-smartsheet-config.json');
const eventsFilePath = path.join(dataDirectory, 'linear-smartsheet-events.json');
const activeSessions = new Map();
const sessionLifetimeMs = 1000 * 60 * 60 * 12;

const defaultColumnMap = {
  linearId: '',
  title: '',
  state: '',
  url: '',
  updatedAt: '',
  kind: '',
  action: '',
  project: '',
  assignee: '',
  team: '',
  priority: '',
  rawPayload: '',
};

const defaultColumnDefinitions = {
  linearId: { title: 'Linear ID', type: 'TEXT_NUMBER' },
  title: { title: 'Title', type: 'TEXT_NUMBER' },
  state: { title: 'State', type: 'TEXT_NUMBER' },
  url: { title: 'Linear URL', type: 'TEXT_NUMBER' },
  updatedAt: { title: 'Updated At', type: 'TEXT_NUMBER' },
  kind: { title: 'Kind', type: 'TEXT_NUMBER' },
  action: { title: 'Action', type: 'TEXT_NUMBER' },
  project: { title: 'Project', type: 'TEXT_NUMBER' },
  assignee: { title: 'Assignee', type: 'TEXT_NUMBER' },
  team: { title: 'Team', type: 'TEXT_NUMBER' },
  priority: { title: 'Priority', type: 'TEXT_NUMBER' },
  rawPayload: { title: 'Linear Payload', type: 'TEXT_NUMBER' },
};

function createDefaultConfig() {
  return {
    enabled: false,
    autoGenerateSheetStructure: true,
    publicBaseUrl: '',
    linearApiKey: '',
    smartsheetApiKey: '',
    smartsheetSheetId: '',
    webhookToken: crypto.randomBytes(24).toString('hex'),
    webhookPreviousTokens: [],
    accessPasswordHash: '',
    smartsheetColumnMap: { ...defaultColumnMap },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function createSessionToken() {
  return crypto.randomBytes(24).toString('hex');
}

function pruneExpiredSessions() {
  const now = Date.now();
  for (const [token, expiresAt] of activeSessions.entries()) {
    if (expiresAt <= now) {
      activeSessions.delete(token);
    }
  }
}

async function ensureDataDirectory() {
  await fs.promises.mkdir(dataDirectory, { recursive: true });
}

async function readJsonFile(filePath, fallbackValue) {
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return fallbackValue;
    }
    throw error;
  }
}

async function writeJsonFile(filePath, value) {
  await ensureDataDirectory();
  await fs.promises.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

async function getStoredConfig() {
  const stored = await readJsonFile(configFilePath, null);
  if (!stored) {
    const defaultConfig = createDefaultConfig();
    await writeJsonFile(configFilePath, defaultConfig);
    return defaultConfig;
  }

  return {
    ...createDefaultConfig(),
    ...stored,
    smartsheetColumnMap: {
      ...defaultColumnMap,
      ...(stored.smartsheetColumnMap || {}),
    },
  };
}

function sanitizeConfig(config) {
  return {
    enabled: Boolean(config.enabled),
    autoGenerateSheetStructure: config.autoGenerateSheetStructure !== false,
    publicBaseUrl: config.publicBaseUrl || '',
    smartsheetSheetId: config.smartsheetSheetId || '',
    webhookToken: config.webhookToken || '',
    webhookUrlPath: '/api/integrations/linear-smartsheet/webhook',
    smartsheetColumnMap: {
      ...defaultColumnMap,
      ...(config.smartsheetColumnMap || {}),
    },
    hasLinearApiKey: Boolean(config.linearApiKey),
    hasSmartsheetApiKey: Boolean(config.smartsheetApiKey),
    hasAccessPassword: Boolean(config.accessPasswordHash),
    createdAt: config.createdAt || null,
    updatedAt: config.updatedAt || null,
  };
}

async function getConfig() {
  return sanitizeConfig(await getStoredConfig());
}

async function saveConfig(input) {
  const current = await getStoredConfig();
  const normalizedPublicBaseUrl = String(input.publicBaseUrl || current.publicBaseUrl || '')
    .trim()
    .replace(/\/+$/, '');
  const next = {
    ...current,
    enabled: Boolean(input.enabled),
    autoGenerateSheetStructure: input.autoGenerateSheetStructure !== false,
    publicBaseUrl: normalizedPublicBaseUrl,
    smartsheetSheetId: (input.smartsheetSheetId || current.smartsheetSheetId || '').trim(),
    webhookToken: (input.webhookToken || current.webhookToken || '').trim() || crypto.randomBytes(24).toString('hex'),
    webhookPreviousTokens: Array.isArray(current.webhookPreviousTokens) ? current.webhookPreviousTokens : [],
    smartsheetColumnMap: {
      ...defaultColumnMap,
      ...current.smartsheetColumnMap,
      ...(input.smartsheetColumnMap || {}),
    },
    updatedAt: new Date().toISOString(),
  };

  const incomingWebhookToken = typeof input.webhookToken === 'string' ? input.webhookToken.trim() : '';
  if (incomingWebhookToken && incomingWebhookToken !== (current.webhookToken || '').trim()) {
    const previousTokens = [
      (current.webhookToken || '').trim(),
      ...(Array.isArray(current.webhookPreviousTokens) ? current.webhookPreviousTokens : []),
    ]
      .filter(Boolean)
      .filter((value, index, array) => array.indexOf(value) === index)
      .slice(0, 3);
    next.webhookPreviousTokens = previousTokens;
  }

  if (typeof input.linearApiKey === 'string' && input.linearApiKey.trim()) {
    next.linearApiKey = input.linearApiKey.trim();
  }

  if (typeof input.smartsheetApiKey === 'string' && input.smartsheetApiKey.trim()) {
    next.smartsheetApiKey = input.smartsheetApiKey.trim();
  }

  if (typeof input.accessPassword === 'string' && input.accessPassword.trim()) {
    next.accessPasswordHash = hashPassword(input.accessPassword.trim());
  }

  await writeJsonFile(configFilePath, next);
  return sanitizeConfig(next);
}

async function getAuthStatus(sessionToken) {
  const config = await getStoredConfig();
  pruneExpiredSessions();
  return {
    hasPassword: Boolean(config.accessPasswordHash),
    isAuthorized: Boolean(sessionToken && activeSessions.has(sessionToken)),
  };
}

async function unlockAccess(password) {
  const config = await getStoredConfig();
  const trimmedPassword = String(password || '').trim();

  if (!trimmedPassword) {
    throw new Error('Password is required.');
  }

  if (!config.accessPasswordHash) {
    const nextConfig = {
      ...config,
      accessPasswordHash: hashPassword(trimmedPassword),
      updatedAt: new Date().toISOString(),
    };
    await writeJsonFile(configFilePath, nextConfig);
  } else if (config.accessPasswordHash !== hashPassword(trimmedPassword)) {
    throw new Error('Invalid password.');
  }

  const sessionToken = createSessionToken();
  activeSessions.set(sessionToken, Date.now() + sessionLifetimeMs);
  return {
    sessionToken,
    expiresInMs: sessionLifetimeMs,
    hasPassword: true,
  };
}

function assertAuthorized(sessionToken) {
  pruneExpiredSessions();
  if (!sessionToken || !activeSessions.has(sessionToken)) {
    throw new Error('Unauthorized Linear sync access.');
  }
}

async function readEventLog() {
  return readJsonFile(eventsFilePath, {
    totalEvents: 0,
    lastEventAt: null,
    lastSyncAt: null,
    lastError: null,
    recentEvents: [],
  });
}

async function writeEventLog(eventLog) {
  await writeJsonFile(eventsFilePath, eventLog);
}

async function appendEventLog(entry) {
  const current = await readEventLog();
  const next = {
    totalEvents: (current.totalEvents || 0) + 1,
    lastEventAt: entry.receivedAt,
    lastSyncAt: entry.success ? entry.receivedAt : current.lastSyncAt || null,
    lastError: entry.success ? null : entry.error || 'Unknown sync error.',
    recentEvents: [entry, ...(current.recentEvents || [])].slice(0, 10),
  };

  await writeEventLog(next);
  return next;
}

function summarizeWebhookPayload(payload) {
  try {
    const record = normalizeLinearPayload(payload || {});
    return {
      linearId: record.linearId || 'unknown',
      summary: `${record.kind || 'Event'} ${record.action || 'update'}: ${record.title || '(untitled)'}`,
    };
  } catch (error) {
    return {
      linearId: 'unknown',
      summary: 'Event update: (unparsed payload)',
    };
  }
}

async function recordWebhookFailure(payload, errorMessage) {
  const details = summarizeWebhookPayload(payload);
  await appendEventLog({
    receivedAt: new Date().toISOString(),
    success: false,
    summary: details.summary,
    linearId: details.linearId,
    error: errorMessage || 'Webhook processing failed.',
  });
}

async function getStatus() {
  const [config, eventLog] = await Promise.all([getStoredConfig(), readEventLog()]);
  return {
    config: sanitizeConfig(config),
    metrics: {
      totalEvents: eventLog.totalEvents || 0,
      lastEventAt: eventLog.lastEventAt || null,
      lastSyncAt: eventLog.lastSyncAt || null,
      lastError: eventLog.lastError || null,
    },
    recentEvents: eventLog.recentEvents || [],
  };
}

function getHeaderValue(headers, headerName) {
  const matchingKey = Object.keys(headers || {}).find((key) => key.toLowerCase() === headerName.toLowerCase());
  return matchingKey ? headers[matchingKey] : undefined;
}

function normalizeLinearPayload(payload) {
  const entity = payload?.data || payload?.issue || payload?.project || payload || {};
  const projectName = entity.project?.name || entity.project?.title || entity.project?.slug || '';
  const assigneeName = entity.assignee?.name || entity.assignee?.displayName || entity.assignee?.email || '';
  const stateName = entity.state?.name || entity.state?.label || entity.status || '';
  const priorityValue = entity.priorityLabel || entity.priority || '';
  const entityType = payload?.type || entity.objectType || (entity.identifier ? 'Issue' : 'Project');
  const action = payload?.action || payload?.event || payload?.trigger || 'update';
  const linearId = entity.id || entity.identifier || payload?.id || '';

  return {
    linearId,
    title: entity.title || entity.name || '(untitled)',
    state: stateName,
    url: entity.url || '',
    updatedAt: entity.updatedAt || payload?.updatedAt || new Date().toISOString(),
    kind: entityType,
    action,
    project: projectName,
    assignee: assigneeName,
    team: entity.team?.name || '',
    priority: priorityValue === '' ? '' : String(priorityValue),
    rawPayload: JSON.stringify(payload).slice(0, 4000),
  };
}

function buildCellValueMap(record) {
  return {
    linearId: record.linearId,
    title: record.title,
    state: record.state,
    url: record.url,
    updatedAt: record.updatedAt,
    kind: record.kind,
    action: record.action,
    project: record.project,
    assignee: record.assignee,
    team: record.team,
    priority: record.priority,
    rawPayload: record.rawPayload,
  };
}

function isDeletionEvent(payload, record) {
  const actionText = String(payload?.action || payload?.event || payload?.trigger || record?.action || '').toLowerCase();
  return actionText.includes('delete') || actionText.includes('remove') || actionText.includes('archive');
}

function buildDeletionAttentionRecord(payload, record) {
  const deletedAt = new Date().toISOString();
  const baseTitle = record.title || '(untitled)';
  return {
    ...record,
    linearId: `${record.linearId}::deleted::${Date.now()}`,
    title: `[RED FLAG] ATTENTION REQUIRED - Deleted in Linear: ${baseTitle}`,
    state: 'DELETED',
    kind: 'RED_FLAG',
    action: 'delete',
    priority: 'RED_FLAG',
    updatedAt: deletedAt,
    rawPayload: JSON.stringify({ deletedAt, payload }).slice(0, 4000),
  };
}

async function smartsheetRequest(config, pathname, options = {}) {
  if (typeof fetch !== 'function') {
    throw new Error('Global fetch is unavailable in this Node runtime.');
  }

  const response = await fetch(`https://api.smartsheet.com/2.0${pathname}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${config.smartsheetApiKey}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Smartsheet request failed (${response.status}): ${errorText || response.statusText}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

function normalizeColumnTitle(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

async function createSmartsheetColumns(config, columnsToCreate, existingColumnCount) {
  if (!columnsToCreate.length) {
    return [];
  }

  // Create columns one at a time to avoid Smartsheet bulk-index constraints.
  const createdColumns = [];

  for (let offset = 0; offset < columnsToCreate.length; offset += 1) {
    const column = columnsToCreate[offset];
    const result = await smartsheetRequest(config, `/sheets/${config.smartsheetSheetId}/columns`, {
      method: 'POST',
      body: {
        title: column.title,
        type: column.type,
        index: existingColumnCount + offset,
      },
    });

    if (result?.result) {
      createdColumns.push(result.result);
    } else if (result?.data) {
      createdColumns.push(result.data);
    }
  }

  return createdColumns;
}

async function ensureSmartsheetColumnMap(config) {
  if (!config.smartsheetApiKey || !config.smartsheetSheetId) {
    throw new Error('Smartsheet API key and sheet ID are required.');
  }

  const sheet = await smartsheetRequest(config, `/sheets/${config.smartsheetSheetId}`);
  const nextColumnMap = {
    ...defaultColumnMap,
    ...(config.smartsheetColumnMap || {}),
  };
  const existingLookup = new Map((sheet.columns || []).map((column) => [normalizeColumnTitle(column.title), column]));
  const columnsToCreate = [];

  for (const [field, definition] of Object.entries(defaultColumnDefinitions)) {
    if (String(nextColumnMap[field] || '').trim()) {
      continue;
    }

    const existing = existingLookup.get(normalizeColumnTitle(definition.title));
    if (existing) {
      nextColumnMap[field] = String(existing.id);
      continue;
    }

    if (config.autoGenerateSheetStructure !== false) {
      columnsToCreate.push({ field, title: definition.title, type: definition.type });
    }
  }

  if (columnsToCreate.length) {
    const createdColumns = await createSmartsheetColumns(config, columnsToCreate, (sheet.columns || []).length);
    for (const createdColumn of createdColumns) {
      const match = columnsToCreate.find((column) => normalizeColumnTitle(column.title) === normalizeColumnTitle(createdColumn.title));
      if (match) {
        nextColumnMap[match.field] = String(createdColumn.id);
      }
    }
  }

  const hasChanges = JSON.stringify(nextColumnMap) !== JSON.stringify({ ...defaultColumnMap, ...(config.smartsheetColumnMap || {}) });
  if (!hasChanges) {
    return { config, sheet };
  }

  const nextConfig = {
    ...config,
    smartsheetColumnMap: nextColumnMap,
    updatedAt: new Date().toISOString(),
  };
  await writeJsonFile(configFilePath, nextConfig);
  return { config: nextConfig, sheet };
}

function buildSmartsheetCells(config, record) {
  const cellValues = buildCellValueMap(record);
  return Object.entries(config.smartsheetColumnMap || {})
    .filter(([, columnId]) => String(columnId || '').trim())
    .map(([field, columnId]) => ({
      columnId: Number(columnId),
      value: cellValues[field] ?? '',
      strict: false,
    }));
}

function findExistingRow(sheet, linearIdColumnId, linearId) {
  const numericColumnId = Number(linearIdColumnId);
  return (sheet.rows || []).find((row) =>
    (row.cells || []).some((cell) => Number(cell.columnId) === numericColumnId && String(cell.displayValue ?? cell.value ?? '') === String(linearId))
  );
}

async function upsertSmartsheetRow(config, record) {
  const ensured = await ensureSmartsheetColumnMap(config);
  const resolvedConfig = ensured.config;

  if (!resolvedConfig.smartsheetColumnMap?.linearId) {
    throw new Error('The Smartsheet Linear ID column is required for upsert matching.');
  }

  const sheet = await smartsheetRequest(resolvedConfig, `/sheets/${resolvedConfig.smartsheetSheetId}`);
  const cells = buildSmartsheetCells(resolvedConfig, record);
  const existingRow = findExistingRow(sheet, resolvedConfig.smartsheetColumnMap.linearId, record.linearId);

  if (existingRow) {
    await smartsheetRequest(resolvedConfig, `/sheets/${resolvedConfig.smartsheetSheetId}/rows`, {
      method: 'PUT',
      body: [{ id: existingRow.id, cells }],
    });
    return { mode: 'updated', rowId: existingRow.id };
  }

  const created = await smartsheetRequest(resolvedConfig, `/sheets/${resolvedConfig.smartsheetSheetId}/rows`, {
    method: 'POST',
    body: [{ toTop: true, cells }],
  });
  return { mode: 'created', rowId: created?.result?.[0]?.id || null };
}

async function createSmartsheetRow(config, record) {
  const ensured = await ensureSmartsheetColumnMap(config);
  const resolvedConfig = ensured.config;
  const cells = buildSmartsheetCells(resolvedConfig, record);

  const created = await smartsheetRequest(resolvedConfig, `/sheets/${resolvedConfig.smartsheetSheetId}/rows`, {
    method: 'POST',
    body: [{ toTop: true, cells }],
  });

  return { mode: 'created', rowId: created?.result?.[0]?.id || null };
}

async function verifyLinearConnection(config) {
  if (!config.linearApiKey) {
    return { ok: false, message: 'Linear API key is not configured.' };
  }

  if (typeof fetch !== 'function') {
    return { ok: false, message: 'Global fetch is unavailable in this Node runtime.' };
  }

  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      Authorization: config.linearApiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: 'query { viewer { id name email } }' }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.errors) {
    return {
      ok: false,
      message: body.errors?.[0]?.message || `Linear request failed with status ${response.status}.`,
    };
  }

  return {
    ok: true,
    message: `Connected as ${body.data?.viewer?.name || body.data?.viewer?.email || 'Linear user'}.`,
  };
}

async function verifySmartsheetConnection(config) {
  if (!config.smartsheetApiKey || !config.smartsheetSheetId) {
    return { ok: false, message: 'Smartsheet API key and sheet ID are required.' };
  }

  try {
    const ensured = await ensureSmartsheetColumnMap(config);
    const sheet = await smartsheetRequest(ensured.config, `/sheets/${ensured.config.smartsheetSheetId}`);
    return {
      ok: true,
      message: `Connected to Smartsheet sheet ${sheet.name || ensured.config.smartsheetSheetId}.`,
    };
  } catch (error) {
    return { ok: false, message: error.message || 'Unable to connect to Smartsheet.' };
  }
}

async function testConnections() {
  const config = await getStoredConfig();
  const [linear, smartsheet] = await Promise.all([
    verifyLinearConnection(config),
    verifySmartsheetConnection(config),
  ]);

  return {
    success: linear.ok && smartsheet.ok,
    linear,
    smartsheet,
  };
}

async function generateSmartsheetStructure() {
  const config = await getStoredConfig();
  const ensured = await ensureSmartsheetColumnMap(config);
  return sanitizeConfig(ensured.config);
}

async function processLinearEvent(payload, requestHeaders = {}) {
  const config = await getStoredConfig();

  try {
    const providedTokenRaw = requestHeaders['x-webhook-token'] || getHeaderValue(requestHeaders, 'x-webhook-token') || payload?.token || payload?.webhookToken || null;
    const providedToken = typeof providedTokenRaw === 'string' ? decodeURIComponent(providedTokenRaw).trim() : null;
    const expectedToken = String(config.webhookToken || '').trim();
    const previousTokens = Array.isArray(config.webhookPreviousTokens)
      ? config.webhookPreviousTokens.map((value) => String(value || '').trim()).filter(Boolean)
      : [];
    const acceptedTokens = [expectedToken, ...previousTokens].filter(Boolean);

    if (!acceptedTokens.length || !providedToken || !acceptedTokens.includes(providedToken)) {
      throw new Error('Invalid webhook token. Copy the latest production webhook URL from Linear Sync and replace the webhook URL in Linear.');
    }

    if (!config.enabled) {
      throw new Error('Linear to Smartsheet sync is disabled.');
    }

    const record = normalizeLinearPayload(payload);
    if (!record.linearId) {
      throw new Error('Linear payload is missing a stable issue or project ID.');
    }

    const deletionEvent = isDeletionEvent(payload, record);
    const finalRecord = deletionEvent ? buildDeletionAttentionRecord(payload, record) : record;
    const result = deletionEvent
      ? await createSmartsheetRow(config, finalRecord)
      : await upsertSmartsheetRow(config, finalRecord);
    const eventEntry = {
      receivedAt: new Date().toISOString(),
      success: true,
      summary: `${finalRecord.kind} ${finalRecord.action}: ${finalRecord.title}`,
      linearId: finalRecord.linearId,
      smartsheetMode: result.mode,
      rowId: result.rowId,
    };

    await appendEventLog(eventEntry);
    return {
      success: true,
      record: finalRecord,
      smartsheet: result,
    };
  } catch (error) {
    await recordWebhookFailure(payload, error?.message || 'Webhook processing failed.');
    throw error;
  }
}

async function processSampleEvent() {
  return processLinearEvent(
    {
      action: 'update',
      type: 'Issue',
      data: {
        id: `sample-${Date.now()}`,
        identifier: 'SYNC-1',
        title: 'Sample Linear issue sync',
        url: 'https://linear.app/',
        updatedAt: new Date().toISOString(),
        state: { name: 'In Progress' },
        project: { name: 'Operations' },
        assignee: { name: 'Automation Bot' },
        team: { name: 'Delivery' },
        priority: 2,
      },
    },
    { 'x-webhook-token': (await getStoredConfig()).webhookToken }
  );
}

module.exports = {
  getConfig,
  saveConfig,
  getAuthStatus,
  unlockAccess,
  assertAuthorized,
  getStatus,
  testConnections,
  generateSmartsheetStructure,
  processLinearEvent,
  processSampleEvent,
};