import { AuthProvider, useAuth } from './context/AuthContext';
import { LoginPage } from './pages/LoginPage';
import { AuthenticatedApp } from './AuthenticatedApp';

function Root() {
  const { token, loading } = useAuth();
  if (loading) return <div className="app-loading">Loading…</div>;
  return token ? <AuthenticatedApp /> : <LoginPage />;
}

export default function App() {
  return (
    <AuthProvider>
      <Root />
    </AuthProvider>
  );
}
