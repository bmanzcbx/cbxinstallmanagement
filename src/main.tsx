import React from 'react';
import ReactDOM from 'react-dom/client';
import { CohortPicker } from './CohortPicker';
import { LinearSmartsheetPage } from './LinearSmartsheetPage';

type AppView = 'scheduler' | 'linear-sync';
const sessionStorageKey = 'linear-sync-session-token';

function getViewFromHash(): AppView {
  return window.location.hash === '#linear-sync' ? 'linear-sync' : 'scheduler';
}

function App() {
  const [view, setView] = React.useState<AppView>(getViewFromHash());
  const [linearSyncUnlocked, setLinearSyncUnlocked] = React.useState(() => Boolean(window.sessionStorage.getItem(sessionStorageKey)));

  React.useEffect(() => {
    const handleHashChange = () => setView(getViewFromHash());
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  React.useEffect(() => {
    const handleFocus = () => setLinearSyncUnlocked(Boolean(window.sessionStorage.getItem(sessionStorageKey)));
    window.addEventListener('focus', handleFocus);
    window.addEventListener('storage', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('storage', handleFocus);
    };
  }, []);

  const title = view === 'linear-sync' ? 'Linear to Smartsheet Automation' : 'CleanBotix Installation Schedule';
  const subtitle = view === 'linear-sync'
    ? 'Configure a webhook-driven sync that forwards Linear issue and project changes into Smartsheet.'
    : 'Select a date range for your booking.';

  return (
    <main
      style={{
        maxWidth: '1180px',
        margin: '2rem auto',
        padding: '1.25rem',
        minHeight: '100vh',
        background: 'linear-gradient(135deg, rgba(14, 116, 144, 0.16), rgba(15, 23, 42, 0.24))',
        borderRadius: '24px',
        boxShadow: '0 18px 50px rgba(2, 6, 23, 0.22)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid rgba(255,255,255,0.28)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
          marginBottom: '1rem',
          padding: '1rem 1.2rem',
          borderRadius: '18px',
          background: 'rgba(255,255,255,0.42)',
          border: '1px solid rgba(255,255,255,0.35)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.45)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <img
            src="/images/Screenshot 2026-07-16 192958.png"
            alt="CleanBotix logo"
            style={{ height: '54px', width: 'auto', objectFit: 'contain', filter: 'drop-shadow(0 8px 20px rgba(2,6,23,0.15))' }}
          />
          <div>
            <h1 style={{ margin: 0, fontSize: '1.6rem', color: '#0f172a' }}>{title}</h1>
            <p style={{ margin: '0.2rem 0 0', color: '#334155' }}>{subtitle}</p>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
          <button
            type="button"
            onClick={() => {
              window.location.hash = '#scheduler';
              setView('scheduler');
            }}
            style={{
              padding: '0.7rem 0.95rem',
              borderRadius: '999px',
              border: view === 'scheduler' ? 'none' : '1px solid rgba(148,163,184,0.35)',
              background: view === 'scheduler' ? '#0f172a' : 'rgba(255,255,255,0.7)',
              color: view === 'scheduler' ? '#fff' : '#0f172a',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Scheduler
          </button>
          <button
            type="button"
            onClick={() => {
              window.location.hash = '#linear-sync';
              setView('linear-sync');
              setLinearSyncUnlocked(Boolean(window.sessionStorage.getItem(sessionStorageKey)));
            }}
            style={{
              padding: '0.7rem 0.95rem',
              borderRadius: '999px',
              border: view === 'linear-sync' ? 'none' : '1px solid rgba(148,163,184,0.35)',
              background: view === 'linear-sync' ? '#0f766e' : 'rgba(255,255,255,0.7)',
              color: view === 'linear-sync' ? '#fff' : '#0f172a',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {linearSyncUnlocked ? 'Linear Sync' : 'Linear Sync Locked'}
          </button>
        </div>
      </div>
      <div
        style={{
          padding: '1rem',
          borderRadius: '20px',
          background: 'rgba(255,255,255,0.56)',
          border: '1px solid rgba(255,255,255,0.38)',
          boxShadow: '0 14px 36px rgba(15,23,42,0.12)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}
      >
        {view === 'linear-sync' ? <LinearSmartsheetPage /> : <CohortPicker />}
      </div>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
