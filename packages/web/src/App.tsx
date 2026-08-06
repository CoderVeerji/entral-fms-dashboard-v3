import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { NavigationProvider } from './context/NavigationContext';
import { ConfirmProvider } from './components/ConfirmDialog';
import { LoadingBar } from './components/LoadingBar';
import { LoginPage } from './pages/LoginPage';
import { AuthenticatedApp } from './AuthenticatedApp';
import { ChangePasswordScreen } from './pages/ChangePasswordScreen';

function Root() {
  const { token, user, loading } = useAuth();
  if (loading) return <div className="app-loading">Loading…</div>;
  if (!token) return <LoginPage />;
  // Blocks all access until a new password is set — matches app/Code.gs's must_change_password
  // flow (first login, or after an admin/self-service password reset). No way to skip this.
  if (user?.mustChangePassword) return <ChangePasswordScreen forced onDone={() => {}} />;
  return <AuthenticatedApp />;
}

export default function App() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <AuthProvider>
          <NavigationProvider>
            <LoadingBar />
            <Root />
          </NavigationProvider>
        </AuthProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}
