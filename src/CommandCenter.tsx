import React from 'react';

type BookingItem = {
  id: string;
  clientName: string;
  location: string;
  botCount: number;
  startDate: string;
  endDate: string;
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
  openDispatchLab: () => void;
};

export function CommandCenter({ openScheduler, openDispatchLab }: CommandCenterProps) {
  const [bookings, setBookings] = React.useState<BookingItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

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

  const riskLabel = metrics.conflictCount > 5 ? 'High conflict pressure' : metrics.conflictCount > 0 ? 'Watch conflicts' : 'Schedule healthy';
  const riskClass = metrics.conflictCount > 5 ? 'danger' : metrics.conflictCount > 0 ? 'warn' : 'ok';

  return (
    <section className="command-center">
      <article className="hero-panel">
        <h2 className="hero-title">Install Operations Nerve Center</h2>
        <p className="hero-copy">
          Coordinate schedule reliability, field capacity, and dispatch readiness from one surface.
          Use this page for triage, then move into the specialized workspace for execution.
        </p>
        <div className="action-row">
          <button type="button" className="action-btn primary" onClick={openScheduler}>Open Planning Studio</button>
          <button type="button" className="action-btn secondary" onClick={openDispatchLab}>Open Dispatch Lab</button>
        </div>
      </article>

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
            <h2 className="panel-title">Executive Signals</h2>
            <span className="badge ok">Ops Summary</span>
          </header>
          <div className="panel-body">
            <div className="ops-list">
              <div className="ops-item">
                <div className="ops-line">Conflict Pressure</div>
                <div className="ops-mini">{metrics.conflictCount > 5 ? 'Immediate intervention recommended.' : metrics.conflictCount > 0 ? 'Moderate risk; intervene this week.' : 'No conflict pressure currently detected.'}</div>
              </div>
              <div className="ops-item">
                <div className="ops-line">Data Quality</div>
                <div className="ops-mini">{metrics.missingDetails} incomplete assignment records require client/location completion.</div>
              </div>
              <div className="ops-item">
                <div className="ops-line">Average Work Block</div>
                <div className="ops-mini">{metrics.avgDuration} days per assignment used for staffing calibration.</div>
              </div>
            </div>

            <div className="action-row">
              <button type="button" className="action-btn secondary" onClick={openDispatchLab}>Launch Dispatch Lab</button>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
