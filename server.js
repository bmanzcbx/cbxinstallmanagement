const express = require('express');
const cors = require('cors');
const path = require('path');

const bookingService = require(path.join(__dirname, 'src', 'bookingService.js'));
const linearSmartsheetService = require(path.join(__dirname, 'src', 'linearSmartsheetService.js'));
const dispatchService = require(path.join(__dirname, 'src', 'dispatchService.js'));
const { createBooking, getBookings, updateBookingDates, updateBookingDetails, exportBookings } = bookingService;
const { getConfig, saveConfig, getAuthStatus, unlockAccess, assertAuthorized, getStatus, testConnections, generateSmartsheetStructure, processLinearEvent, processSampleEvent } = linearSmartsheetService;
const { generateIntelligentSetupLink, reserveMultiDayProjectDispatch } = dispatchService;
const distDirectory = path.join(__dirname, 'dist');
const distIndexFile = path.join(distDirectory, 'index.html');

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
app.use(cors());
app.use(express.json());

app.get('/healthz', (req, res) => {
  res.status(200).json({ ok: true });
});

app.get('/api/bookings', async (req, res) => {
  if (!getBookings) {
    return res.status(503).json({ success: false, message: 'Booking service unavailable.' });
  }

  try {
    const result = await getBookings();
    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Unable to load bookings.' });
  }
});

app.get('/api/bookings/export', async (req, res) => {
  try {
    const format = req.query.format === 'csv' ? 'csv' : 'json';
    const payload = await exportBookings(format);

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="bookings.csv"');
      res.send(payload);
      return;
    }

    res.json({ success: true, data: payload });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Unable to export bookings.' });
  }
});

app.post('/api/bookings', async (req, res) => {
  if (!createBooking) {
    return res.status(503).json({ success: false, message: 'Booking service unavailable.' });
  }

  try {
    const { roomId, start, end, clientName = '', location = '', botCount = 0 } = req.body;
    const result = await createBooking(roomId, new Date(start), new Date(end), {
      clientName,
      location,
      botCount: Number(botCount) || 0,
    });
    res.json({
      ...result,
      message: result.success
        ? 'Booking request submitted. Awaiting admin approval.'
        : result.message || 'Booking request failed.',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Booking service error.',
      error: error?.message || String(error),
      code: error?.code || null,
    });
  }
});

app.patch('/api/bookings/:id', async (req, res) => {
  if (!updateBookingDates) {
    return res.status(503).json({ success: false, message: 'Booking service unavailable.' });
  }

  try {
    const { id } = req.params;
    const { start, end } = req.body;
    const result = await updateBookingDates(id, new Date(start), new Date(end));
    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Unable to update booking.' });
  }
});

app.patch('/api/bookings/:id/details', async (req, res) => {
  if (!updateBookingDetails) {
    return res.status(503).json({ success: false, message: 'Booking service unavailable.' });
  }

  try {
    const { id } = req.params;
    const { clientName, location, botCount } = req.body;
    const result = await updateBookingDetails(id, {
      clientName,
      location,
      botCount: Number(botCount) || 0,
    });
    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Unable to update booking details.' });
  }
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

app.post('/api/dispatch/route-setup', async (req, res) => {
  try {
    const zip = String(req.body?.zip || '').trim();
    const product = String(req.body?.product || '').trim();

    if (!zip || !product) {
      return res.status(400).json({
        success: false,
        fallbackToManualDispatch: true,
        message: 'Both zip and product are required.',
      });
    }

    const bookingsResult = await getBookings();
    const bookings = bookingsResult?.success && Array.isArray(bookingsResult.data) ? bookingsResult.data : [];

    const result = await generateIntelligentSetupLink(zip, product, { bookings });
    res.json(result);
  } catch (error) {
    console.error('Dispatch routing failure', error);
    res.status(400).json({
      success: false,
      fallbackToManualDispatch: true,
      message: error?.message || 'Unable to generate an intelligent setup link.',
    });
  }
});

app.post('/api/dispatch/book-multi-day', async (req, res) => {
  try {
    const zip = String(req.body?.zip || '').trim();
    const product = String(req.body?.product || '').trim();
    const startDate = String(req.body?.startDate || '').trim();
    const totalDays = Number(req.body?.totalDays || 0);

    if (!zip || !product || !startDate || !Number.isInteger(totalDays) || totalDays < 1) {
      return res.status(400).json({
        success: false,
        fallbackToManualDispatch: true,
        message: 'zip, product, startDate, and an integer totalDays >= 1 are required.',
      });
    }

    const bookingsResult = await getBookings();
    const bookings = bookingsResult?.success && Array.isArray(bookingsResult.data) ? bookingsResult.data : [];

    const result = await reserveMultiDayProjectDispatch({ zip, product, startDate, totalDays }, { bookings });
    res.json(result);
  } catch (error) {
    console.error('Dispatch multi-day booking failure', error);
    res.status(400).json({
      success: false,
      fallbackToManualDispatch: true,
      message: error?.message || 'Unable to reserve multi-day project blocks.',
    });
  }
});

app.use(express.static(distDirectory));

app.get(/^(?!\/api(?:\/|$)).*/, (req, res) => {
  res.sendFile(distIndexFile);
});

const port = Number(process.env.PORT) || 3001;

app.listen(port, () => {
  console.log(`Booking API listening on http://localhost:${port}`);
});
