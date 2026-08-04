import { AuthProvider, useAuth } from './context/AuthContext';
import { LoginPage } from './pages/LoginPage';
import { DashboardShellPage } from './pages/DashboardShellPage';

function Root() {
  const { token, loading } = useAuth();
  if (loading) return <div className="app-loading">Loading…</div>;
  return token ? <DashboardShellPage /> : <LoginPage />;
}

export default function App() {
  return (
    <AuthProvider>
      <Root />
    </AuthProvider>
  );
}
