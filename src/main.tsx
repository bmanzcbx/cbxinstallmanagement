import React from 'react';
import ReactDOM from 'react-dom/client';
import { CohortPicker } from './CohortPicker';
import { LinearSmartsheetPage } from './LinearSmartsheetPage';
import { CommandCenter } from './CommandCenter';
import { DispatchLab } from './DispatchLab';
import './app-shell.css';

type AppView = 'command-center' | 'scheduler' | 'dispatch-lab' | 'linear-sync';
const sessionStorageKey = 'linear-sync-session-token';
const adminSessionStorageKey = 'cleanbotix-admin-session-token';

function getViewFromHash(): AppView {
  if (window.location.hash === '#scheduler') {
    return 'scheduler';
  }

  if (window.location.hash === '#linear-sync') {
    return 'linear-sync';
  }

  if (window.location.hash === '#dispatch-lab') {
    return 'dispatch-lab';
  }

  return 'command-center';
}

function App() {
  const [view, setView] = React.useState<AppView>(getViewFromHash());
  const [linearSyncUnlocked, setLinearSyncUnlocked] = React.useState(() => Boolean(window.sessionStorage.getItem(sessionStorageKey)));
  const [adminAccess, setAdminAccess] = React.useState(false);
  const [showAdminPrompt, setShowAdminPrompt] = React.useState(false);
  const [adminCode, setAdminCode] = React.useState('');
  const [adminMessage, setAdminMessage] = React.useState<string | null>(null);
  const [adminBusy, setAdminBusy] = React.useState(false);
  const [pendingAdminView, setPendingAdminView] = React.useState<AppView>('linear-sync');

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

  React.useEffect(() => {
    const sessionToken = window.sessionStorage.getItem(adminSessionStorageKey);
    if (!sessionToken) {
      return;
    }

    let mounted = true;
    const validateAdminSession = async () => {
      try {
        const response = await fetch('/api/admin/access-status', {
          headers: {
            'x-admin-session': sessionToken,
          },
        });
        const payload = await response.json();
        if (mounted) {
          setAdminAccess(Boolean(response.ok && payload?.success && payload?.data?.authorized));
        }
      } catch (error) {
        if (mounted) {
          setAdminAccess(false);
        }
      }
    };

    void validateAdminSession();
    return () => {
      mounted = false;
    };
  }, []);

  React.useEffect(() => {
    if (view === 'linear-sync' && !adminAccess) {
      setView('command-center');
      window.location.hash = '#command-center';
    }
  }, [adminAccess, view]);

  const switchView = (next: AppView) => {
    setView(next);
    window.location.hash = `#${next}`;
  };

  const handleAdminAccess = async () => {
    const code = adminCode.trim();
    if (!code) {
      setAdminMessage('Enter admin access code.');
      return;
    }

    setAdminBusy(true);
    setAdminMessage(null);
    try {
      const response = await fetch('/api/admin/access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const payload = await response.json();

      if (!response.ok || !payload?.success || !payload?.data?.sessionToken) {
        throw new Error(payload?.message || 'Admin access denied.');
      }

      window.sessionStorage.setItem(adminSessionStorageKey, payload.data.sessionToken);
      setAdminAccess(true);
      setShowAdminPrompt(false);
      setAdminCode('');
      setAdminMessage(null);
      switchView(pendingAdminView);
    } catch (error) {
      setAdminMessage(error instanceof Error ? error.message : 'Admin access denied.');
    } finally {
      setAdminBusy(false);
    }
  };

  const title = view === 'linear-sync'
    ? 'Linear Sync Administration'
    : view === 'dispatch-lab'
      ? 'Dispatch Lab'
    : view === 'scheduler'
      ? 'Scheduling Workspace'
      : 'Operations Command Center';
  const subtitle = view === 'linear-sync'
    ? 'Protected integration controls for Linear to Smartsheet sync.'
    : view === 'dispatch-lab'
      ? 'Collective routing, multi-day reservation, and booking response intelligence.'
    : view === 'scheduler'
      ? 'Calendar, Gantt, Capacity, and Installer planning tools.'
      : 'Operational intelligence, dispatch acceleration, and risk triage in one view.';

  return (
    <main className="app-shell">
      <div className="app-topbar">
        <div className="brand-block">
          <img
            src="/images/Screenshot 2026-07-16 192958.png"
            alt="CleanBotix logo"
            className="brand-logo"
          />
          <div>
            <h1 className="brand-title">{title}</h1>
            <p className="brand-subtitle">{subtitle}</p>
          </div>
        </div>

        <div className="main-nav">
          <button
            className={`nav-btn ${view === 'command-center' ? 'active' : ''}`}
            type="button"
            onClick={() => switchView('command-center')}
          >
            Command Center
          </button>
          <button
            className={`nav-btn ${view === 'scheduler' ? 'active' : ''}`}
            type="button"
            onClick={() => switchView('scheduler')}
          >
            Planning Studio
          </button>
          <button
            className={`nav-btn ${view === 'dispatch-lab' ? 'active' : ''}`}
            type="button"
            onClick={() => switchView('dispatch-lab')}
          >
            Dispatch Lab
          </button>
        </div>
      </div>

      <div className="app-content">
        {view === 'command-center' ? <CommandCenter openScheduler={() => switchView('scheduler')} openDispatchLab={() => switchView('dispatch-lab')} /> : null}
        {view === 'scheduler' ? <CohortPicker /> : null}
        {view === 'dispatch-lab' ? <DispatchLab /> : null}
        {view === 'linear-sync' ? <LinearSmartsheetPage /> : null}
      </div>

      <div className="shell-footer">
        <button
          type="button"
          className="admin-trigger"
          onClick={() => {
            setPendingAdminView('linear-sync');
            setShowAdminPrompt(true);
            setAdminMessage(null);
            setAdminCode('');
          }}
        >
          {adminAccess ? (linearSyncUnlocked ? 'Admin Open' : 'Admin Locked') : 'Admin'}
        </button>
      </div>

      {showAdminPrompt ? (
        <div className="modal-scrim" onClick={() => setShowAdminPrompt(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h2 className="modal-title">Administration Access</h2>
            <p className="modal-copy">This hidden area contains integration controls and remains protected.</p>
            <input
              value={adminCode}
              onChange={(event) => setAdminCode(event.target.value)}
              type="password"
              placeholder="Enter admin access code"
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void handleAdminAccess();
                }
              }}
            />
            {adminMessage ? <p className="modal-copy" style={{ color: '#b91c1c' }}>{adminMessage}</p> : null}
            <div className="modal-actions">
              <button type="button" className="modal-btn" onClick={() => setShowAdminPrompt(false)}>Cancel</button>
              <button type="button" className="modal-btn primary" onClick={() => void handleAdminAccess()} disabled={adminBusy}>{adminBusy ? 'Checking...' : 'Enter Admin Area'}</button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
