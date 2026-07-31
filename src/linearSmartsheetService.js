import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  targetDate: '',
  dueDate: '',
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
  targetDate: { title: 'Target Date', type: 'TEXT_NUMBER' },
  dueDate: { title: 'Due Date', type: 'TEXT_NUMBER' },
  kind: { title: 'Kind', type: 'TEXT_NUMBER' },
  action: { title: 'Action', type: 'TEXT_NUMBER' },
  project: { title: 'Project', type: 'TEXT_NUMBER' },
  assignee: { title: 'Assignee', type: 'TEXT_NUMBER' },
  team: { title: 'Team', type: 'TEXT_NUMBER' },
  priority: { title: 'Priority', type: 'TEXT_NUMBER' },
  rawPayload: { title: 'Linear Payload', type: 'TEXT_NUMBER' },
};

function getManagedWebhookToken() {
  const envToken = process.env.LINEAR_WEBHOOK_TOKEN;
  return typeof envToken === 'string' ? envToken.trim() : '';
}

function getManagedLinearApiKey() {
  const envValue = process.env.LINEAR_API_KEY;
  return typeof envValue === 'string' ? envValue.trim() : '';
}

function getManagedSmartsheetApiKey() {
  const envValue = process.env.SMARTSHEET_API_KEY;
  return typeof envValue === 'string' ? envValue.trim() : '';
}

function getManagedSmartsheetSheetId() {
  const envValue = process.env.SMARTSHEET_SHEET_ID;
  return typeof envValue === 'string' ? envValue.trim() : '';
}

function getManagedSyncEnabled() {
  const rawValue = process.env.LINEAR_SYNC_ENABLED;
  if (typeof rawValue !== 'string') {
    return null;
  }

  const value = rawValue.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(value)) {
    return false;
  }
  return null;
}

function resolveWebhookToken(config) {
  return getManagedWebhookToken() || String(config?.webhookToken || '').trim();
}

function applyManagedConfig(config) {
  return {
    ...config,
    linearApiKey: getManagedLinearApiKey() || String(config?.linearApiKey || '').trim(),
    smartsheetApiKey: getManagedSmartsheetApiKey() || String(config?.smartsheetApiKey || '').trim(),
    smartsheetSheetId: getManagedSmartsheetSheetId() || String(config?.smartsheetSheetId || '').trim(),
    webhookToken: resolveWebhookToken(config),
  };
}

function createDefaultConfig() {
  return {
    enabled: false,
    autoGenerateSheetStructure: true,
    publicBaseUrl: '',
    linearApiKey: '',
    smartsheetApiKey: '',
    smartsheetSheetId: '',
    webhookToken: getManagedWebhookToken() || crypto.randomBytes(24).toString('hex'),
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
    return applyManagedConfig(defaultConfig);
  }

  return applyManagedConfig({
    ...createDefaultConfig(),
    ...stored,
    smartsheetColumnMap: {
      ...defaultColumnMap,
      ...(stored.smartsheetColumnMap || {}),
    },
  });
}

function sanitizeConfig(config) {
  const managedWebhookToken = getManagedWebhookToken();
  const managedSyncEnabled = getManagedSyncEnabled();
  const resolvedWebhookToken = resolveWebhookToken(config);
  const managedLinearApiKey = getManagedLinearApiKey();
  const managedSmartsheetApiKey = getManagedSmartsheetApiKey();
  const managedSmartsheetSheetId = getManagedSmartsheetSheetId();
  return {
    enabled: managedSyncEnabled === null ? Boolean(config.enabled) : managedSyncEnabled,
    enabledManaged: managedSyncEnabled !== null,
    autoGenerateSheetStructure: config.autoGenerateSheetStructure !== false,
    publicBaseUrl: config.publicBaseUrl || '',
    smartsheetSheetId: managedSmartsheetSheetId || config.smartsheetSheetId || '',
    webhookToken: resolvedWebhookToken,
    webhookTokenManaged: Boolean(managedWebhookToken),
    linearApiKeyManaged: Boolean(managedLinearApiKey),
    smartsheetApiKeyManaged: Boolean(managedSmartsheetApiKey),
    smartsheetSheetIdManaged: Boolean(managedSmartsheetSheetId),
    webhookUrlPath: '/api/integrations/linear-smartsheet/webhook',
    smartsheetColumnMap: {
      ...defaultColumnMap,
      ...(config.smartsheetColumnMap || {}),
    },
    hasLinearApiKey: Boolean(managedLinearApiKey || config.linearApiKey),
    hasSmartsheetApiKey: Boolean(managedSmartsheetApiKey || config.smartsheetApiKey),
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
  const managedWebhookToken = getManagedWebhookToken();
  const managedSyncEnabled = getManagedSyncEnabled();
  const normalizedPublicBaseUrl = String(input.publicBaseUrl || current.publicBaseUrl || '')
    .trim()
    .replace(/\/+$/, '');
  const next = {
    ...current,
    enabled: managedSyncEnabled === null ? Boolean(input.enabled) : managedSyncEnabled,
    autoGenerateSheetStructure: input.autoGenerateSheetStructure !== false,
    publicBaseUrl: normalizedPublicBaseUrl,
    smartsheetSheetId: (input.smartsheetSheetId || current.smartsheetSheetId || '').trim(),
    webhookToken: managedWebhookToken || (input.webhookToken || current.webhookToken || '').trim() || crypto.randomBytes(24).toString('hex'),
    webhookPreviousTokens: Array.isArray(current.webhookPreviousTokens) ? current.webhookPreviousTokens : [],
    smartsheetColumnMap: {
      ...defaultColumnMap,
      ...current.smartsheetColumnMap,
      ...(input.smartsheetColumnMap || {}),
    },
    updatedAt: new Date().toISOString(),
  };

  const incomingWebhookToken = typeof input.webhookToken === 'string' ? input.webhookToken.trim() : '';
  if (!managedWebhookToken && incomingWebhookToken && incomingWebhookToken !== (current.webhookToken || '').trim()) {
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

function toTextValue(value) {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  try {
    return JSON.stringify(value);
  } catch (error) {
    return String(value);
  }
}

function pickFirstTextValue(candidates) {
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) {
      continue;
    }

    const text = toTextValue(candidate).trim();
    if (text) {
      return text;
    }
  }

  return '';
}

function normalizeLinearPayload(payload) {
  const entity = payload?.data || payload?.issue || payload?.project || payload || {};
  const projectName = pickFirstTextValue([entity.project?.name, entity.project?.title, entity.project?.slug]);
  const assigneeName = pickFirstTextValue([entity.assignee?.name, entity.assignee?.displayName, entity.assignee?.email]);
  const stateName = pickFirstTextValue([entity.state?.name, entity.state?.label, entity.status?.name, entity.status]);
  const priorityValue = pickFirstTextValue([entity.priorityLabel, entity.priority?.label, entity.priority?.name, entity.priority]);
  const entityType = pickFirstTextValue([payload?.type, entity.objectType, entity.identifier ? 'Issue' : 'Project']) || 'Issue';
  const action = pickFirstTextValue([payload?.action, payload?.event, payload?.trigger]) || 'update';
  const linearId = pickFirstTextValue([entity.id, entity.identifier, payload?.id]);
  const title = pickFirstTextValue([entity.title, entity.name]) || '(untitled)';
  const updatedAt = pickFirstTextValue([entity.updatedAt, payload?.updatedAt]) || new Date().toISOString();
  const targetDate = pickFirstTextValue([entity.targetDate, entity.targetDateAt, entity.project?.targetDate, entity.project?.targetDateAt]);
  const dueDate = pickFirstTextValue([entity.dueDate, entity.dueAt, entity.project?.dueDate, entity.project?.dueAt]);
  const url = pickFirstTextValue([entity.url]);
  const team = pickFirstTextValue([entity.team?.name, entity.team?.displayName, entity.team?.key]);
  const safeRawPayload = toTextValue(payload).slice(0, 4000);

  return {
    linearId,
    title,
    state: stateName,
    url,
    updatedAt,
    targetDate,
    dueDate,
    kind: entityType,
    action,
    project: projectName,
    assignee: assigneeName,
    team,
    priority: priorityValue,
    rawPayload: safeRawPayload,
  };
}

function buildCellValueMap(record) {
  return {
    linearId: record.linearId,
    title: record.title,
    state: record.state,
    url: record.url,
    updatedAt: record.updatedAt,
    targetDate: record.targetDate,
    dueDate: record.dueDate,
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
    .map(([field, columnId]) => {
      const numericColumnId = Number(String(columnId).trim());
      if (!Number.isFinite(numericColumnId)) {
        return null;
      }

      return {
        columnId: numericColumnId,
        value: toTextValue(cellValues[field]),
        strict: false,
      };
    })
    .filter(Boolean);
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
    const expectedToken = resolveWebhookToken(config);
    const previousTokens = Array.isArray(config.webhookPreviousTokens)
      ? config.webhookPreviousTokens.map((value) => String(value || '').trim()).filter(Boolean)
      : [];
    const acceptedTokens = [expectedToken, ...previousTokens].filter(Boolean);

    if (!acceptedTokens.length || !providedToken || !acceptedTokens.includes(providedToken)) {
      throw new Error('Invalid webhook token. Copy the latest production webhook URL from Linear Sync and replace the webhook URL in Linear.');
    }

    const managedSyncEnabled = getManagedSyncEnabled();
    const syncEnabled = managedSyncEnabled === null ? Boolean(config.enabled) : managedSyncEnabled;

    if (!syncEnabled) {
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
        targetDate: '2026-08-15',
        dueDate: '2026-08-20',
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

export {
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