import { useAuth } from '../context/AuthContext';
import { LiveRecordsPage } from './LiveRecordsPage';

// Real nav/sidebar (multi-page routing) is M2 scope per the plan — M1's goal is Live Records
// itself being fast, not the surrounding shell, so this renders it directly for now.
export function DashboardShellPage() {
  const { user, logout } = useAuth();

  return (
    <div className="app-shell">
      <header className="app-shell-header">
        <span>Central FMS Management Dashboard</span>
        <div className="app-shell-user">
          <span>{user?.fullName || user?.username} ({user?.roleName})</span>
          <button onClick={() => logout()}>Sign out</button>
        </div>
      </header>
      <main className="app-shell-main">
        <LiveRecordsPage />
      </main>
    </div>
  );
}
