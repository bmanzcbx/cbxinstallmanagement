import { useEffect, useState } from 'react';

type ColumnMap = {
  linearId: string;
  title: string;
  state: string;
  url: string;
  updatedAt: string;
  kind: string;
  action: string;
  project: string;
  assignee: string;
  team: string;
  priority: string;
  rawPayload: string;
};

type IntegrationConfig = {
  enabled: boolean;
  autoGenerateSheetStructure: boolean;
  publicBaseUrl: string;
  smartsheetSheetId: string;
  webhookToken: string;
  webhookUrlPath: string;
  smartsheetColumnMap: ColumnMap;
  hasLinearApiKey: boolean;
  hasSmartsheetApiKey: boolean;
  hasAccessPassword: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

type StatusMetrics = {
  totalEvents: number;
  lastEventAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
};

type RecentEvent = {
  receivedAt: string;
  success: boolean;
  summary: string;
  linearId: string;
  smartsheetMode?: string;
  rowId?: number | null;
};

type IntegrationStatus = {
  config: IntegrationConfig;
  metrics: StatusMetrics;
  recentEvents: RecentEvent[];
};

type AuthStatus = {
  hasPassword: boolean;
  isAuthorized: boolean;
};

type UnlockResult = {
  sessionToken: string;
  expiresInMs: number;
  hasPassword: boolean;
};

type SaveForm = {
  enabled: boolean;
  autoGenerateSheetStructure: boolean;
  publicBaseUrl: string;
  linearApiKey: string;
  smartsheetApiKey: string;
  smartsheetSheetId: string;
  webhookToken: string;
  accessPassword: string;
  smartsheetColumnMap: ColumnMap;
};

type ApiEnvelope<T> = {
  success: boolean;
  data?: T;
  message?: string;
};

const sessionStorageKey = 'linear-sync-session-token';

const emptyColumnMap: ColumnMap = {
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

const emptyConfig: IntegrationConfig = {
  enabled: false,
  autoGenerateSheetStructure: true,
  publicBaseUrl: '',
  smartsheetSheetId: '',
  webhookToken: '',
  webhookUrlPath: '/api/integrations/linear-smartsheet/webhook',
  smartsheetColumnMap: emptyColumnMap,
  hasLinearApiKey: false,
  hasSmartsheetApiKey: false,
  hasAccessPassword: false,
  createdAt: null,
  updatedAt: null,
};

const columnFields: Array<{ key: keyof ColumnMap; label: string; hint: string }> = [
  { key: 'linearId', label: 'Linear ID column', hint: 'Required for upsert matching. This field is generated automatically when possible.' },
  { key: 'title', label: 'Title column', hint: 'Issue or project title.' },
  { key: 'state', label: 'State column', hint: 'Current workflow state.' },
  { key: 'url', label: 'URL column', hint: 'Linear link.' },
  { key: 'updatedAt', label: 'Updated At column', hint: 'Last update timestamp from Linear.' },
  { key: 'kind', label: 'Kind column', hint: 'Issue or Project.' },
  { key: 'action', label: 'Action column', hint: 'create, update, or another webhook action.' },
  { key: 'project', label: 'Project column', hint: 'Linked project name when present.' },
  { key: 'assignee', label: 'Assignee column', hint: 'Assigned user.' },
  { key: 'team', label: 'Team column', hint: 'Linear team name.' },
  { key: 'priority', label: 'Priority column', hint: 'Priority label or numeric value.' },
  { key: 'rawPayload', label: 'Raw payload column', hint: 'Optional. Stores the received Linear payload JSON.' },
];

async function readJsonResponse<T>(response: Response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  return JSON.parse(text) as T;
}

function formatTimestamp(value: string | null) {
  if (!value) {
    return 'Never';
  }

  return new Date(value).toLocaleString();
}

function getStoredSessionToken() {
  return window.sessionStorage.getItem(sessionStorageKey) || '';
}

function setStoredSessionToken(token: string) {
  if (token) {
    window.sessionStorage.setItem(sessionStorageKey, token);
    return;
  }

  window.sessionStorage.removeItem(sessionStorageKey);
}

function createInitialForm(config: IntegrationConfig): SaveForm {
  return {
    enabled: config.enabled,
    autoGenerateSheetStructure: config.autoGenerateSheetStructure,
    publicBaseUrl: config.publicBaseUrl || '',
    linearApiKey: '',
    smartsheetApiKey: '',
    smartsheetSheetId: config.smartsheetSheetId || '',
    webhookToken: config.webhookToken || '',
    accessPassword: '',
    smartsheetColumnMap: {
      ...emptyColumnMap,
      ...(config.smartsheetColumnMap || {}),
    },
  };
}

export function LinearSmartsheetPage() {
  const [config, setConfig] = useState<IntegrationConfig>(emptyConfig);
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [form, setForm] = useState<SaveForm>(createInitialForm(emptyConfig));
  const [passwordInput, setPasswordInput] = useState('');
  const [showUnlockPassword, setShowUnlockPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const copyToClipboard = async (value: string) => {
    if (!value) {
      setMessage({ tone: 'error', text: 'Webhook URL is empty.' });
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      setMessage({ tone: 'success', text: 'Webhook URL copied.' });
    } catch (error) {
      setMessage({ tone: 'error', text: 'Unable to copy to clipboard in this browser.' });
    }
  };

  const authFetch = async (input: string, init: RequestInit = {}) => {
    const sessionToken = getStoredSessionToken();
    const headers = new Headers(init.headers || {});
    if (sessionToken) {
      headers.set('x-linear-sync-session', sessionToken);
    }

    return fetch(input, { ...init, headers });
  };

  const loadProtectedPage = async () => {
    setIsLoading(true);
    try {
      const [configResponse, statusResponse] = await Promise.all([
        authFetch('/api/integrations/linear-smartsheet/config'),
        authFetch('/api/integrations/linear-smartsheet/status'),
      ]);

      if (configResponse.status === 401 || statusResponse.status === 401) {
        setStoredSessionToken('');
        setAuthStatus((current) => ({ hasPassword: current?.hasPassword ?? true, isAuthorized: false }));
        setMessage({ tone: 'error', text: 'The Linear sync area is locked. Enter your password again.' });
        return;
      }

      const configPayload = await readJsonResponse<ApiEnvelope<IntegrationConfig>>(configResponse);
      const statusPayload = await readJsonResponse<ApiEnvelope<IntegrationStatus>>(statusResponse);

      if (!configResponse.ok || !configPayload?.success || !configPayload.data) {
        throw new Error(configPayload?.message || 'Unable to load integration settings.');
      }

      const nextConfig = configPayload.data;
      setConfig(nextConfig);
      setForm(createInitialForm(nextConfig));
      setAuthStatus({ hasPassword: nextConfig.hasAccessPassword, isAuthorized: true });

      if (statusResponse.ok && statusPayload?.success && statusPayload.data) {
        setStatus(statusPayload.data);
      } else {
        setStatus(null);
      }
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Unable to load page data.' });
    } finally {
      setIsLoading(false);
    }
  };

  const loadAuthStatus = async () => {
    setIsLoading(true);
    try {
      const response = await authFetch('/api/integrations/linear-smartsheet/auth-status');
      const payload = await readJsonResponse<ApiEnvelope<AuthStatus>>(response);
      if (!response.ok || !payload?.success || !payload.data) {
        throw new Error(payload?.message || 'Unable to load Linear sync access status.');
      }

      setAuthStatus(payload.data);
      if (payload.data.isAuthorized) {
        await loadProtectedPage();
        return;
      }
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Unable to load Linear sync access status.' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadAuthStatus();
  }, []);

  const unlockPage = async () => {
    setBusyAction('unlock');
    setMessage(null);

    try {
      const response = await fetch('/api/integrations/linear-smartsheet/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passwordInput }),
      });
      const payload = await readJsonResponse<ApiEnvelope<UnlockResult>>(response);
      if (!response.ok || !payload?.success || !payload.data) {
        throw new Error(payload?.message || 'Unable to unlock Linear sync access.');
      }

      setStoredSessionToken(payload.data.sessionToken);
      setPasswordInput('');
      setAuthStatus({ hasPassword: payload.data.hasPassword, isAuthorized: true });
      setMessage({ tone: 'success', text: authStatus?.hasPassword ? 'Linear sync unlocked.' : 'Password created and Linear sync unlocked.' });
      await loadProtectedPage();
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Unable to unlock Linear sync access.' });
    } finally {
      setBusyAction(null);
    }
  };

  const saveConfig = async () => {
    setBusyAction('save');
    setMessage(null);

    try {
      const response = await authFetch('/api/integrations/linear-smartsheet/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const payload = await readJsonResponse<ApiEnvelope<IntegrationConfig>>(response);
      if (!response.ok || !payload?.success || !payload.data) {
        throw new Error(payload?.message || 'Unable to save integration settings.');
      }

      setConfig(payload.data);
      setForm(createInitialForm(payload.data));
      setMessage({ tone: 'success', text: payload.message || 'Integration settings saved.' });
      await loadProtectedPage();
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Unable to save integration settings.' });
    } finally {
      setBusyAction(null);
    }
  };

  const runConnectionTest = async () => {
    setBusyAction('test');
    setMessage(null);

    try {
      const response = await authFetch('/api/integrations/linear-smartsheet/test', { method: 'POST' });
      const payload = await readJsonResponse<ApiEnvelope<{ linear: { message: string }; smartsheet: { message: string } }>>(response);
      if (!response.ok || !payload?.data) {
        throw new Error(payload?.message || 'Connection test failed.');
      }

      setMessage({ tone: 'success', text: `${payload.data.linear.message} ${payload.data.smartsheet.message}` });
      await loadProtectedPage();
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Connection test failed.' });
    } finally {
      setBusyAction(null);
    }
  };

  const runSampleSync = async () => {
    setBusyAction('sample');
    setMessage(null);

    try {
      const response = await authFetch('/api/integrations/linear-smartsheet/sample-sync', { method: 'POST' });
      const payload = await readJsonResponse<ApiEnvelope<unknown>>(response);
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.message || 'Sample sync failed.');
      }

      setMessage({ tone: 'success', text: payload.message || 'Sample sync completed.' });
      await loadProtectedPage();
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Sample sync failed.' });
    } finally {
      setBusyAction(null);
    }
  };

  const generateStructure = async () => {
    setBusyAction('generate');
    setMessage(null);

    try {
      const response = await authFetch('/api/integrations/linear-smartsheet/generate-structure', { method: 'POST' });
      const payload = await readJsonResponse<ApiEnvelope<IntegrationConfig>>(response);
      if (!response.ok || !payload?.success || !payload.data) {
        throw new Error(payload?.message || 'Unable to generate Smartsheet fields automatically.');
      }

      setConfig(payload.data);
      setForm(createInitialForm(payload.data));
      setMessage({ tone: 'success', text: payload.message || 'Smartsheet fields generated automatically.' });
      await loadProtectedPage();
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Unable to generate Smartsheet fields automatically.' });
    } finally {
      setBusyAction(null);
    }
  };

  const lockPage = () => {
    setStoredSessionToken('');
    setAuthStatus((current) => ({ hasPassword: current?.hasPassword ?? true, isAuthorized: false }));
    setMessage({ tone: 'success', text: 'Linear sync access locked.' });
  };

  const updateColumn = (key: keyof ColumnMap, value: string) => {
    setForm((current) => ({
      ...current,
      smartsheetColumnMap: {
        ...current.smartsheetColumnMap,
        [key]: value,
      },
    }));
  };

  const webhookBaseOrigin = (form.publicBaseUrl || config.publicBaseUrl || window.location.origin).trim().replace(/\/+$/, '');
  const webhookUrl = `${webhookBaseOrigin}${config.webhookUrlPath}?token=${encodeURIComponent(form.webhookToken || config.webhookToken || '')}`;
  const showHttpsWarning = Boolean(form.publicBaseUrl) && !form.publicBaseUrl.trim().toLowerCase().startsWith('https://');

  if (!authStatus?.isAuthorized) {
    return (
      <div style={{ display: 'grid', gap: '1rem' }}>
        <section style={lockedCardStyle}>
          <h2 style={{ margin: 0, color: '#0f172a' }}>Protected Linear Sync</h2>
          <p style={{ margin: '0.65rem 0 0', color: '#475569', lineHeight: 1.55 }}>
            {authStatus?.hasPassword
              ? 'This page is locked. Enter your password to manage the Linear to Smartsheet automation.'
              : 'Set a password now. After it is saved, the Linear Sync area and its API endpoints will require that password.'}
          </p>
        </section>

        {message ? (
          <div style={message.tone === 'success' ? successNoticeStyle : errorNoticeStyle}>{message.text}</div>
        ) : null}

        <section style={panelStyle}>
          <label style={{ display: 'grid', gap: '0.45rem', color: '#0f172a' }}>
            <span style={{ fontWeight: 700 }}>{authStatus?.hasPassword ? 'Password' : 'Create password'}</span>
            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
              <input
                type={showUnlockPassword ? 'text' : 'password'}
                value={passwordInput}
                onChange={(event) => setPasswordInput(event.target.value)}
                placeholder={authStatus?.hasPassword ? 'Enter your Linear Sync password' : 'Create a password only you know'}
                style={inputStyle}
              />
              <button
                type="button"
                onClick={() => setShowUnlockPassword((current) => !current)}
                style={ghostButtonStyle}
              >
                {showUnlockPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
            <button type="button" onClick={() => void unlockPage()} disabled={busyAction !== null || isLoading} style={primaryButtonStyle}>
              {busyAction === 'unlock' ? 'Unlocking...' : authStatus?.hasPassword ? 'Unlock Linear Sync' : 'Create password and unlock'}
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <section style={lockedCardStyle}>
        <h2 style={{ margin: 0, color: '#0f172a' }}>Linear to Smartsheet Sync</h2>
        <p style={{ margin: '0.65rem 0 0', color: '#475569', lineHeight: 1.55 }}>
          The service can build the Smartsheet destination fields for you. Once connected, incoming Linear issue and project data can generate the target sheet structure automatically and keep rows updated 24/7.
        </p>
      </section>

      {message ? (
        <div style={message.tone === 'success' ? successNoticeStyle : errorNoticeStyle}>{message.text}</div>
      ) : null}

      <section style={panelStyle}>
        <div style={{ display: 'grid', gap: '0.35rem' }}>
          <label style={{ fontWeight: 700, color: '#0f172a' }}>
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))}
              style={{ marginRight: '0.6rem' }}
            />
            Enable automatic webhook sync
          </label>
          <label style={{ fontWeight: 700, color: '#0f172a' }}>
            <input
              type="checkbox"
              checked={form.autoGenerateSheetStructure}
              onChange={(event) => setForm((current) => ({ ...current, autoGenerateSheetStructure: event.target.checked }))}
              style={{ marginRight: '0.6rem' }}
            />
            Generate Smartsheet fields automatically from Linear data
          </label>
          <span style={{ color: '#64748b', fontSize: '0.95rem' }}>
            With automatic generation on, the backend will locate matching columns by title or create the missing destination fields in your sheet.
          </span>
        </div>

        <div style={{ display: 'grid', gap: '0.9rem', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
          <label style={{ display: 'grid', gap: '0.35rem', color: '#0f172a' }}>
            <span style={{ fontWeight: 700 }}>Render base URL</span>
            <input
              type="text"
              value={form.publicBaseUrl}
              onChange={(event) => setForm((current) => ({ ...current, publicBaseUrl: event.target.value }))}
              placeholder="https://your-service.onrender.com"
              style={inputStyle}
            />
            <span style={{ color: '#64748b', fontSize: '0.9rem' }}>
              Stored and used to generate the exact webhook URL for Linear.
            </span>
          </label>

          <label style={{ display: 'grid', gap: '0.35rem', color: '#0f172a' }}>
            <span style={{ fontWeight: 700 }}>Linear API key</span>
            <input
              type="password"
              value={form.linearApiKey}
              onChange={(event) => setForm((current) => ({ ...current, linearApiKey: event.target.value }))}
              placeholder={config.hasLinearApiKey ? 'Stored. Enter a new value only to replace it.' : 'lin_api_...'}
              style={inputStyle}
            />
          </label>

          <label style={{ display: 'grid', gap: '0.35rem', color: '#0f172a' }}>
            <span style={{ fontWeight: 700 }}>Smartsheet API key</span>
            <input
              type="password"
              value={form.smartsheetApiKey}
              onChange={(event) => setForm((current) => ({ ...current, smartsheetApiKey: event.target.value }))}
              placeholder={config.hasSmartsheetApiKey ? 'Stored. Enter a new value only to replace it.' : 'Smartsheet token'}
              style={inputStyle}
            />
          </label>

          <label style={{ display: 'grid', gap: '0.35rem', color: '#0f172a' }}>
            <span style={{ fontWeight: 700 }}>Smartsheet sheet ID</span>
            <input
              type="text"
              value={form.smartsheetSheetId}
              onChange={(event) => setForm((current) => ({ ...current, smartsheetSheetId: event.target.value }))}
              placeholder="1234567890123456"
              style={inputStyle}
            />
          </label>

          <label style={{ display: 'grid', gap: '0.35rem', color: '#0f172a' }}>
            <span style={{ fontWeight: 700 }}>Webhook token</span>
            <input
              type="text"
              value={form.webhookToken}
              onChange={(event) => setForm((current) => ({ ...current, webhookToken: event.target.value }))}
              placeholder="Shared secret appended to the webhook URL"
              style={inputStyle}
            />
          </label>

          <label style={{ display: 'grid', gap: '0.35rem', color: '#0f172a' }}>
            <span style={{ fontWeight: 700 }}>Change access password</span>
            <input
              type="password"
              value={form.accessPassword}
              onChange={(event) => setForm((current) => ({ ...current, accessPassword: event.target.value }))}
              placeholder="Optional. Leave blank to keep the current password."
              style={inputStyle}
            />
          </label>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
          <button type="button" onClick={() => void saveConfig()} disabled={busyAction !== null || isLoading} style={primaryButtonStyle}>
            {busyAction === 'save' ? 'Saving...' : 'Save settings'}
          </button>
          <button type="button" onClick={() => void runConnectionTest()} disabled={busyAction !== null || isLoading} style={secondaryButtonStyle}>
            {busyAction === 'test' ? 'Testing...' : 'Test connections'}
          </button>
          <button type="button" onClick={() => void generateStructure()} disabled={busyAction !== null || isLoading} style={secondaryButtonStyle}>
            {busyAction === 'generate' ? 'Generating...' : 'Generate Smartsheet fields'}
          </button>
          <button type="button" onClick={() => void runSampleSync()} disabled={busyAction !== null || isLoading} style={secondaryButtonStyle}>
            {busyAction === 'sample' ? 'Syncing...' : 'Send sample sync'}
          </button>
          <button type="button" onClick={() => void loadProtectedPage()} disabled={busyAction !== null} style={ghostButtonStyle}>
            Refresh status
          </button>
          <button type="button" onClick={lockPage} disabled={busyAction !== null} style={ghostButtonStyle}>
            Lock page
          </button>
        </div>
      </section>

      <section style={panelStyle}>
        <h3 style={{ margin: 0, color: '#0f172a' }}>Webhook setup</h3>
        <p style={{ margin: 0, color: '#475569', lineHeight: 1.55 }}>
          In Linear, create a webhook for issue and project events and point it to this URL. When automatic field generation is enabled, the backend will map or create the Smartsheet destination fields before inserting or updating rows.
        </p>
        <textarea readOnly value={webhookUrl} rows={3} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'Consolas, monospace' }} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
          <button type="button" onClick={() => void copyToClipboard(webhookUrl)} style={ghostButtonStyle}>
            Copy webhook URL
          </button>
        </div>
        <div style={{ display: 'grid', gap: '0.35rem', color: '#64748b', fontSize: '0.95rem' }}>
          <span>Recommended Linear events: issue create, issue update, project create, project update.</span>
          {showHttpsWarning ? <span style={{ color: '#991b1b' }}>Render base URL should start with https:// for Linear webhooks.</span> : null}
          <span>This app only runs 24/7 when the server is deployed somewhere always-on.</span>
        </div>
      </section>

      <section style={panelStyle}>
        <h3 style={{ margin: 0, color: '#0f172a' }}>Smartsheet field mapping</h3>
        <p style={{ margin: 0, color: '#475569', lineHeight: 1.55 }}>
          These column IDs are optional when auto-generation is enabled. Use them only if you want to override the automatically located or created fields.
        </p>
        <div style={{ display: 'grid', gap: '0.9rem', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
          {columnFields.map((field) => (
            <label key={field.key} style={{ display: 'grid', gap: '0.35rem', color: '#0f172a' }}>
              <span style={{ fontWeight: 700 }}>{field.label}</span>
              <input
                type="text"
                value={form.smartsheetColumnMap[field.key]}
                onChange={(event) => updateColumn(field.key, event.target.value)}
                placeholder="Smartsheet column ID"
                style={inputStyle}
              />
              <span style={{ color: '#64748b', fontSize: '0.9rem' }}>{field.hint}</span>
            </label>
          ))}
        </div>
      </section>

      <section style={panelStyle}>
        <h3 style={{ margin: 0, color: '#0f172a' }}>Status</h3>
        {isLoading ? <p style={{ margin: 0, color: '#64748b' }}>Loading integration state...</p> : null}
        <div style={{ display: 'grid', gap: '0.45rem', color: '#334155' }}>
          <span>Total events received: {status?.metrics.totalEvents ?? 0}</span>
          <span>Last event: {formatTimestamp(status?.metrics.lastEventAt ?? null)}</span>
          <span>Last successful sync: {formatTimestamp(status?.metrics.lastSyncAt ?? null)}</span>
          <span>Last error: {status?.metrics.lastError || 'None'}</span>
          <span>Last saved settings: {formatTimestamp(config.updatedAt)}</span>
        </div>
        <div style={{ display: 'grid', gap: '0.6rem' }}>
          {(status?.recentEvents || []).map((event) => (
            <div key={`${event.receivedAt}-${event.linearId}`} style={eventCardStyle}>
              <div style={{ fontWeight: 700, color: '#0f172a' }}>{event.summary}</div>
              <div style={{ fontSize: '0.92rem', marginTop: '0.2rem' }}>
                {formatTimestamp(event.receivedAt)} • Linear ID {event.linearId} • {event.smartsheetMode || 'processed'}
              </div>
            </div>
          ))}
          {status?.recentEvents?.length ? null : <p style={{ margin: 0, color: '#64748b' }}>No webhook events have been processed yet.</p>}
        </div>
      </section>
    </div>
  );
}

const inputStyle = {
  width: '100%',
  padding: '0.8rem 0.9rem',
  borderRadius: '12px',
  border: '1px solid rgba(148, 163, 184, 0.4)',
  background: '#fff',
  color: '#0f172a',
  boxSizing: 'border-box' as const,
};

const panelStyle = {
  padding: '1.25rem',
  borderRadius: '18px',
  background: 'rgba(255,255,255,0.72)',
  border: '1px solid rgba(255,255,255,0.35)',
  display: 'grid',
  gap: '1rem',
};

const lockedCardStyle = {
  padding: '1.25rem',
  borderRadius: '18px',
  background: 'rgba(248, 250, 252, 0.9)',
  border: '1px solid rgba(148, 163, 184, 0.3)',
  boxShadow: '0 16px 40px rgba(15,23,42,0.08)',
};

const successNoticeStyle = {
  padding: '0.85rem 1rem',
  borderRadius: '14px',
  background: 'rgba(22, 163, 74, 0.12)',
  color: '#166534',
  border: '1px solid rgba(22, 163, 74, 0.25)',
};

const errorNoticeStyle = {
  padding: '0.85rem 1rem',
  borderRadius: '14px',
  background: 'rgba(220, 38, 38, 0.12)',
  color: '#991b1b',
  border: '1px solid rgba(220, 38, 38, 0.25)',
};

const eventCardStyle = {
  padding: '0.8rem 0.9rem',
  borderRadius: '14px',
  background: 'rgba(241,245,249,0.85)',
  border: '1px solid rgba(148,163,184,0.2)',
  color: '#334155',
};

const primaryButtonStyle = {
  padding: '0.8rem 1rem',
  borderRadius: '999px',
  border: 'none',
  background: '#0f766e',
  color: '#fff',
  fontWeight: 700,
  cursor: 'pointer',
};

const secondaryButtonStyle = {
  padding: '0.8rem 1rem',
  borderRadius: '999px',
  border: '1px solid rgba(15, 118, 110, 0.3)',
  background: 'rgba(240, 253, 250, 0.95)',
  color: '#115e59',
  fontWeight: 700,
  cursor: 'pointer',
};

const ghostButtonStyle = {
  padding: '0.8rem 1rem',
  borderRadius: '999px',
  border: '1px solid rgba(148, 163, 184, 0.4)',
  background: '#fff',
  color: '#334155',
  fontWeight: 700,
  cursor: 'pointer',
};