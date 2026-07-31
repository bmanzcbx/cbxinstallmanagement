import React from 'react';

type BookingItem = {
  id: string;
  clientName: string;
  location: string;
  botCount: number;
  startDate: string;
  endDate: string;
};

type DispatchResult = {
  success: boolean;
  message?: string;
  bookingUrl?: string;
  bookingUrls?: string[];
  assignedTeam?: {
    manager: string;
    technician: string;
  };
  territory?: string;
  totalWorkingDays?: number;
};

function toDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function overlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart <= bEnd && bStart <= aEnd;
}

function formatRange(startDate: string, endDate: string) {
  const start = toDate(startDate);
  const end = toDate(endDate);
  if (!start || !end) {
    return 'Unknown';
  }

  return `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`;
}

function computeMetrics(bookings: BookingItem[]) {
  const now = new Date();
  const nextSeven = new Date(now);
  nextSeven.setDate(now.getDate() + 7);

  let upcomingWeek = 0;
  let missingDetails = 0;
  let totalBots = 0;
  let totalDays = 0;

  const conflicts: Array<{ left: BookingItem; right: BookingItem }> = [];

  for (let i = 0; i < bookings.length; i += 1) {
    const booking = bookings[i];
    const start = toDate(booking.startDate);
    const end = toDate(booking.endDate);

    if (!start || !end) {
      missingDetails += 1;
      continue;
    }

    totalBots += Number(booking.botCount) || 0;
    totalDays += Math.max(1, Math.floor((end.getTime() - start.getTime()) / 86400000) + 1);

    if (overlap(start, end, now, nextSeven)) {
      upcomingWeek += 1;
    }

    if (!String(booking.clientName || '').trim() || !String(booking.location || '').trim()) {
      missingDetails += 1;
    }

    for (let j = i + 1; j < bookings.length; j += 1) {
      const next = bookings[j];
      const nStart = toDate(next.startDate);
      const nEnd = toDate(next.endDate);
      if (!nStart || !nEnd) {
        continue;
      }

      if (overlap(start, end, nStart, nEnd)) {
        conflicts.push({ left: booking, right: next });
      }
    }
  }

  const avgDuration = bookings.length ? (totalDays / bookings.length).toFixed(1) : '0.0';

  return {
    totalBookings: bookings.length,
    upcomingWeek,
    conflicts: conflicts.slice(0, 8),
    conflictCount: conflicts.length,
    totalBots,
    avgDuration,
    missingDetails,
  };
}

type CommandCenterProps = {
  openScheduler: () => void;
};

export function CommandCenter({ openScheduler }: CommandCenterProps) {
  const [bookings, setBookings] = React.useState<BookingItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [zip, setZip] = React.useState('60611');
  const [product, setProduct] = React.useState('CBX-Pro');
  const [startDate, setStartDate] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [totalDays, setTotalDays] = React.useState(5);
  const [busy, setBusy] = React.useState(false);
  const [dispatchResult, setDispatchResult] = React.useState<DispatchResult | null>(null);

  React.useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch('/api/bookings', { cache: 'no-store' });
        const payload = await response.json();

        if (!response.ok || !payload?.success || !Array.isArray(payload?.data)) {
          throw new Error(payload?.message || 'Unable to load operational data.');
        }

        if (mounted) {
          setBookings(payload.data);
        }
      } catch (loadError) {
        if (mounted) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load operational data.');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      mounted = false;
    };
  }, []);

  const metrics = React.useMemo(() => computeMetrics(bookings), [bookings]);

  const runDispatch = async (mode: 'single' | 'multi') => {
    setBusy(true);
    setDispatchResult(null);

    try {
      const path = mode === 'single' ? '/api/dispatch/route-setup' : '/api/dispatch/book-multi-day';
      const body = mode === 'single'
        ? { zip, product }
        : { zip, product, startDate, totalDays: Number(totalDays) || 1, clientName: 'Dispatch Ops', clientEmail: 'dispatch@example.com' };

      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.message || 'Dispatch action failed.');
      }

      setDispatchResult(payload);
    } catch (dispatchError) {
      setDispatchResult({ success: false, message: dispatchError instanceof Error ? dispatchError.message : 'Dispatch action failed.' });
    } finally {
      setBusy(false);
    }
  };

  const riskLabel = metrics.conflictCount > 5 ? 'High conflict pressure' : metrics.conflictCount > 0 ? 'Watch conflicts' : 'Schedule healthy';
  const riskClass = metrics.conflictCount > 5 ? 'danger' : metrics.conflictCount > 0 ? 'warn' : 'ok';

  return (
    <section className="command-center">
      <div className="kpi-grid">
        <article className="kpi-card">
          <div className="kpi-label">Total Assignments</div>
          <div className="kpi-value">{metrics.totalBookings}</div>
          <div className="kpi-note">Live booking objects in plan</div>
        </article>
        <article className="kpi-card">
          <div className="kpi-label">Next 7 Days</div>
          <div className="kpi-value">{metrics.upcomingWeek}</div>
          <div className="kpi-note">Jobs intersecting the next week</div>
        </article>
        <article className="kpi-card">
          <div className="kpi-label">Fleet Load</div>
          <div className="kpi-value">{metrics.totalBots}</div>
          <div className="kpi-note">Total bots scheduled</div>
        </article>
        <article className="kpi-card">
          <div className="kpi-label">Avg Duration</div>
          <div className="kpi-value">{metrics.avgDuration}d</div>
          <div className="kpi-note">Average booking span</div>
        </article>
      </div>

      <div className="ops-grid">
        <article className="panel">
          <header className="panel-head">
            <h2 className="panel-title">Operations Queue</h2>
            <span className={`badge ${riskClass}`}>{riskLabel}</span>
          </header>
          <div className="panel-body">
            {loading ? <div className="ops-mini">Loading planning signals...</div> : null}
            {error ? <div className="callout bad">{error}</div> : null}
            {!loading && !error ? (
              <>
                <div className="ops-list">
                  <div className="ops-item">
                    <div className="ops-line">{metrics.conflictCount} date overlap conflict{metrics.conflictCount === 1 ? '' : 's'} detected</div>
                    <div className="ops-mini">Resolve in Scheduler to protect technician utilization.</div>
                  </div>
                  <div className="ops-item">
                    <div className="ops-line">{metrics.missingDetails} assignment{metrics.missingDetails === 1 ? '' : 's'} missing client/location details</div>
                    <div className="ops-mini">Complete metadata for cleaner dispatch handoff.</div>
                  </div>
                </div>

                {metrics.conflicts.length ? (
                  <div className="ops-list">
                    {metrics.conflicts.map((pair, index) => (
                      <div className="ops-item" key={`${pair.left.id}-${pair.right.id}-${index}`}>
                        <div className="ops-line">{pair.left.clientName || 'Client'} overlaps {pair.right.clientName || 'Client'}</div>
                        <div className="ops-mini">{formatRange(pair.left.startDate, pair.left.endDate)} vs {formatRange(pair.right.startDate, pair.right.endDate)}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="callout good">No date overlaps detected right now. Your schedule window is stable.</div>
                )}

                <div className="action-row">
                  <button type="button" className="action-btn secondary" onClick={openScheduler}>Open Scheduler Workspace</button>
                </div>
              </>
            ) : null}
          </div>
        </article>

        <article className="panel">
          <header className="panel-head">
            <h2 className="panel-title">Dispatch Accelerator</h2>
            <span className="badge ok">Live API</span>
          </header>
          <div className="panel-body">
            <div className="inline-form">
              <input value={zip} onChange={(event) => setZip(event.target.value)} placeholder="ZIP" />
              <input value={product} onChange={(event) => setProduct(event.target.value)} placeholder="Product" />
              <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
              <input type="number" min={1} max={30} value={totalDays} onChange={(event) => setTotalDays(Math.max(1, Math.min(30, Number(event.target.value) || 1)))} placeholder="Days" />
            </div>

            <div className="action-row">
              <button type="button" className="action-btn primary" disabled={busy} onClick={() => void runDispatch('single')}>
                {busy ? 'Working...' : 'Generate Setup Link'}
              </button>
              <button type="button" className="action-btn secondary" disabled={busy} onClick={() => void runDispatch('multi')}>
                {busy ? 'Working...' : 'Reserve Multi-Day Block'}
              </button>
            </div>

            {dispatchResult?.success ? (
              <div className="callout good">
                Team: {dispatchResult.assignedTeam?.manager || 'Manager'} + {dispatchResult.assignedTeam?.technician || 'Technician'}
                <br />
                Territory: {dispatchResult.territory || 'Unknown'}
                {dispatchResult.totalWorkingDays ? <><br />Reserved days: {dispatchResult.totalWorkingDays}</> : null}
                {dispatchResult.bookingUrl ? <><br /><a href={dispatchResult.bookingUrl} target="_blank" rel="noreferrer">{dispatchResult.bookingUrl}</a></> : null}
              </div>
            ) : null}

            {dispatchResult && !dispatchResult.success ? <div className="callout bad">{dispatchResult.message || 'Dispatch action failed.'}</div> : null}
          </div>
        </article>
      </div>
    </section>
  );
}
