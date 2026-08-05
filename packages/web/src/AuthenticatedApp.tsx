import { useEffect, useState } from 'react';
import { AppShell } from './components/AppShell';
import { DashboardPage } from './pages/DashboardPage';
import { LiveRecordsPage } from './pages/LiveRecordsPage';
import { DataHealthPage } from './pages/DataHealthPage';
import { applyTheme, getStoredTheme } from './theme';

// Hash-based routing (matches app/index.html's own approach) — no react-router dependency needed
// for the handful of pages that exist so far.
function readRouteFromHash(): string {
  const hash = window.location.hash.replace('#', '');
  return hash || 'dashboard';
}

export function AuthenticatedApp() {
  const [route, setRoute] = useState(readRouteFromHash());

  useEffect(() => { applyTheme(getStoredTheme()); }, []);

  useEffect(() => {
    const onHashChange = () => setRoute(readRouteFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  function navigate(next: string) {
    window.location.hash = next;
    setRoute(next);
  }

  return (
    <AppShell route={route} onNavigate={navigate}>
      {route === 'liveRecords' ? <LiveRecordsPage /> : route === 'dataHealth' ? <DataHealthPage /> : <DashboardPage />}
    </AppShell>
  );
}
