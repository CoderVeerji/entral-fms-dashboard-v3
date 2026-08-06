import { useEffect } from 'react';
import { AppShell } from './components/AppShell';
import { ErrorBoundary } from './components/ErrorBoundary';
import { DashboardPage } from './pages/DashboardPage';
import { AiAssistantPage } from './pages/AiAssistantPage';
import { LiveRecordsPage } from './pages/LiveRecordsPage';
import { UpdateHealthPage } from './pages/UpdateHealthPage';
import { BottleneckPage } from './pages/BottleneckPage';
import { MisReportPage } from './pages/MisReportPage';
import { DoerPerformancePage } from './pages/DoerPerformancePage';
import { ActionCenterPage } from './pages/ActionCenterPage';
import { DataHealthPage } from './pages/DataHealthPage';
import { UsersPage } from './pages/UsersPage';
import { RolesPage } from './pages/RolesPage';
import { SettingsPage } from './pages/SettingsPage';
import { LogsPage } from './pages/LogsPage';
import { FmsSourcesPage } from './pages/FmsSourcesPage';
import { AboutPage } from './pages/AboutPage';
import { MyAccountPage } from './pages/MyAccountPage';
import { useNavigation } from './context/NavigationContext';
import { applyTheme, getStoredTheme, applyAccent, getStoredAccent } from './theme';

export function AuthenticatedApp() {
  const { route, navigate } = useNavigation();

  useEffect(() => { applyTheme(getStoredTheme()); applyAccent(getStoredAccent()); }, []);

  return (
    <AppShell route={route} onNavigate={navigate}>
      {/* Remounted (key={route}) on every navigation so a crash on one page never lingers into
          the next one visited — same "one broken page can't white-screen the whole app" pattern
          as app/index.html's per-route ErrorBoundary. */}
      <ErrorBoundary key={route}>
        {route === 'aiAssistant' ? <AiAssistantPage />
          : route === 'liveRecords' ? <LiveRecordsPage />
          : route === 'updateHealth' ? <UpdateHealthPage />
          : route === 'bottlenecks' ? <BottleneckPage />
          : route === 'misReport' ? <MisReportPage />
          : route === 'doerPerformance' ? <DoerPerformancePage />
          : route === 'actionCenter' ? <ActionCenterPage />
          : route === 'dataHealth' ? <DataHealthPage />
          : route === 'users' ? <UsersPage />
          : route === 'roles' ? <RolesPage />
          : route === 'settings' ? <SettingsPage />
          : route === 'logs' ? <LogsPage />
          : route === 'fmsSources' ? <FmsSourcesPage />
          : route === 'about' ? <AboutPage />
          : route === 'myAccount' ? <MyAccountPage />
          : <DashboardPage />}
      </ErrorBoundary>
    </AppShell>
  );
}
