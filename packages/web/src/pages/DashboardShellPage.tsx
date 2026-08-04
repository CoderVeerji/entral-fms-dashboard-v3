import { useAuth } from '../context/AuthContext';

// Placeholder authenticated shell for M0 — real pages (Dashboard, Live Records, etc.) get built
// out starting M1/M2 per the plan's phased rollout. This exists so M0's Definition of Done ("log
// into the new stack, see an empty authenticated shell") is concretely checkable end-to-end.
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
        <p>Signed in successfully. Live Records, Dashboard, and the rest of the app land in the next phase (M1+).</p>
      </main>
    </div>
  );
}
