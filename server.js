import express from 'express';
import {
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
} from './src/linearSmartsheetService.js';

function getLinearSyncSessionToken(req) {
  return req.headers['x-linear-sync-session'] || req.query.sessionToken || null;
}

function requireLinearSyncAccess(req, res, next) {
  try {
    assertAuthorized(getLinearSyncSessionToken(req));
    next();
  } catch (error) {
    res.status(401).json({ success: false, message: error?.message || 'Unauthorized.' });
  }
}

const app = express();
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-linear-sync-session, x-webhook-token');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});
app.use(express.json());

app.get('/healthz', (req, res) => {
  res.status(200).json({ ok: true });
});

app.get('/api/integrations/linear-smartsheet/auth-status', async (req, res) => {
  try {
    const status = await getAuthStatus(getLinearSyncSessionToken(req));
    res.json({ success: true, data: status });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Unable to load auth status.' });
  }
});

app.post('/api/integrations/linear-smartsheet/unlock', async (req, res) => {
  try {
    const result = await unlockAccess(req.body?.password);
    res.json({ success: true, data: result, message: 'Linear sync unlocked.' });
  } catch (error) {
    console.error(error);
    res.status(401).json({ success: false, message: error?.message || 'Unable to unlock access.' });
  }
});

app.get('/api/integrations/linear-smartsheet/config', requireLinearSyncAccess, async (req, res) => {
  try {
    const config = await getConfig();
    res.json({ success: true, data: config });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Unable to load integration config.' });
  }
});

app.post('/api/integrations/linear-smartsheet/config', requireLinearSyncAccess, async (req, res) => {
  try {
    const config = await saveConfig(req.body || {});
    res.json({ success: true, data: config, message: 'Integration settings saved.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Unable to save integration config.' });
  }
});

app.get('/api/integrations/linear-smartsheet/status', requireLinearSyncAccess, async (req, res) => {
  try {
    const status = await getStatus();
    res.json({ success: true, data: status });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Unable to load integration status.' });
  }
});

app.post('/api/integrations/linear-smartsheet/test', requireLinearSyncAccess, async (req, res) => {
  try {
    const result = await testConnections();
    const combinedMessage = `${result.linear?.message || ''} ${result.smartsheet?.message || ''}`.trim() || 'Connection test completed.';
    res.status(result.success ? 200 : 400).json({ success: result.success, data: result, message: combinedMessage });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Unable to test integration connections.' });
  }
});

app.post('/api/integrations/linear-smartsheet/generate-structure', requireLinearSyncAccess, async (req, res) => {
  try {
    const config = await generateSmartsheetStructure();
    res.json({ success: true, data: config, message: 'Smartsheet fields generated automatically.' });
  } catch (error) {
    console.error(error);
    res.status(400).json({ success: false, message: error?.message || 'Unable to generate Smartsheet fields.' });
  }
});

app.post('/api/integrations/linear-smartsheet/sample-sync', requireLinearSyncAccess, async (req, res) => {
  try {
    const result = await processSampleEvent();
    res.json({ success: true, data: result, message: 'Sample sync completed.' });
  } catch (error) {
    console.error(error);
    res.status(400).json({ success: false, message: error?.message || 'Sample sync failed.' });
  }
});

app.post('/api/integrations/linear-smartsheet/webhook', async (req, res) => {
  try {
    const token = req.query.token;
    const result = await processLinearEvent(
      { ...(req.body || {}), token: typeof token === 'string' ? token : undefined },
      req.headers || {}
    );
    res.json({ success: true, data: result });
  } catch (error) {
    console.error(error);
    const isAuthError = String(error?.message || '').toLowerCase().includes('token');
    res.status(isAuthError ? 401 : 400).json({ success: false, message: error?.message || 'Webhook processing failed.' });
  }
});

const port = Number(process.env.PORT) || 3001;

app.listen(port, () => {
  console.log(`Linear listener API listening on http://localhost:${port}`);
});
