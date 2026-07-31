import React from 'react';

type DispatchResult = {
  success: boolean;
  message?: string;
  bookingUrl?: string;
  bookingUrls?: string[];
  activeBlockIds?: Array<string | number>;
  assignedTeam?: {
    manager: string;
    technician: string;
  };
  territory?: string;
  totalWorkingDays?: number;
};

export function DispatchLab() {
  const [zip, setZip] = React.useState('60611');
  const [product, setProduct] = React.useState('CBX-Pro');
  const [startDate, setStartDate] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [totalDays, setTotalDays] = React.useState(5);
  const [clientName, setClientName] = React.useState('Dispatch Ops');
  const [clientEmail, setClientEmail] = React.useState('dispatch@example.com');
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<DispatchResult | null>(null);

  const runDispatch = async (mode: 'single' | 'multi') => {
    setBusy(true);
    setResult(null);

    try {
      const endpoint = mode === 'single' ? '/api/dispatch/route-setup' : '/api/dispatch/book-multi-day';
      const body = mode === 'single'
        ? { zip, product }
        : {
            zip,
            product,
            startDate,
            totalDays: Number(totalDays) || 1,
            clientName,
            clientEmail,
          };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.message || 'Dispatch request failed.');
      }

      setResult(payload);
    } catch (error) {
      setResult({ success: false, message: error instanceof Error ? error.message : 'Dispatch request failed.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="dispatch-lab">
      <article className="hero-panel">
        <h2 className="hero-title">Dispatch Lab</h2>
        <p className="hero-copy">
          High-speed routing console for collective Cal booking and multi-day block orchestration.
          Use this to coordinate team assignment and reduce manual back-and-forth.
        </p>
      </article>

      <div className="dispatch-grid">
        <article className="panel">
          <header className="panel-head">
            <h3 className="panel-title">Routing Inputs</h3>
            <span className="badge ok">Optimized Flow</span>
          </header>
          <div className="panel-body">
            <div className="inline-form inline-form-2col">
              <input value={zip} onChange={(event) => setZip(event.target.value)} placeholder="ZIP (e.g. 60611)" />
              <input value={product} onChange={(event) => setProduct(event.target.value)} placeholder="Product Model" />
              <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
              <input type="number" min={1} max={30} value={totalDays} onChange={(event) => setTotalDays(Math.max(1, Math.min(30, Number(event.target.value) || 1)))} placeholder="Project Days" />
              <input value={clientName} onChange={(event) => setClientName(event.target.value)} placeholder="Client Name" />
              <input value={clientEmail} onChange={(event) => setClientEmail(event.target.value)} placeholder="Client Email" />
            </div>

            <div className="action-row">
              <button type="button" className="action-btn primary" disabled={busy} onClick={() => void runDispatch('single')}>
                {busy ? 'Processing...' : 'Generate Setup Link'}
              </button>
              <button type="button" className="action-btn secondary" disabled={busy} onClick={() => void runDispatch('multi')}>
                {busy ? 'Processing...' : 'Reserve Multi-Day'}
              </button>
            </div>
          </div>
        </article>

        <article className="panel">
          <header className="panel-head">
            <h3 className="panel-title">Dispatch Result</h3>
            <span className="badge warn">Live Response</span>
          </header>
          <div className="panel-body">
            {!result ? <div className="ops-mini">Run a dispatch action to view team assignment and booking output.</div> : null}

            {result?.success ? (
              <div className="callout good">
                Team: {result.assignedTeam?.manager || 'Manager'} + {result.assignedTeam?.technician || 'Technician'}
                <br />
                Territory: {result.territory || 'Unknown'}
                {result.totalWorkingDays ? <><br />Working days reserved: {result.totalWorkingDays}</> : null}
                {result.activeBlockIds?.length ? <><br />Active blocks: {result.activeBlockIds.length}</> : null}
                {result.bookingUrl ? <><br /><a href={result.bookingUrl} target="_blank" rel="noreferrer">{result.bookingUrl}</a></> : null}
              </div>
            ) : null}

            {result?.success && result.bookingUrls?.length ? (
              <div className="ops-list">
                {result.bookingUrls.map((url) => (
                  <div className="ops-item" key={url}>
                    <div className="ops-line">Day booking URL</div>
                    <a href={url} target="_blank" rel="noreferrer" className="ops-mini">{url}</a>
                  </div>
                ))}
              </div>
            ) : null}

            {result && !result.success ? <div className="callout bad">{result.message || 'Dispatch failed.'}</div> : null}
          </div>
        </article>
      </div>
    </section>
  );
}
