import { useState, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import * as api from '../api';

export function LoginPage() {
  const [mode, setMode] = useState<'login' | 'forgot'>('login');
  return mode === 'login' ? <LoginForm onForgot={() => setMode('forgot')} /> : <ForgotPasswordForm onBack={() => setMode('login')} />;
}

function LoginForm({ onForgot }: { onForgot: () => void }) {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const res = await login(username, password, rememberMe);
    setSubmitting(false);
    if (!res.ok) setError(res.message);
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>Central FMS Management Dashboard</h1>
        <p className="login-subtitle">Le Fabco Pvt. Ltd.</p>

        {error && <div className="login-error">{error}</div>}

        <label>
          Username
          <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <label className="login-remember">
          <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
          Remember me on this device
        </label>

        <button type="submit" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign In'}</button>
        <button type="button" onClick={onForgot} style={{ background: 'transparent', color: 'var(--blue)', fontWeight: 600, marginTop: 4 }}>
          Forgot password?
        </button>
      </form>
    </div>
  );
}

function ForgotPasswordForm({ onBack }: { onBack: () => void }) {
  const [username, setUsername] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const res = await api.requestPasswordReset(username);
    setSubmitting(false);
    setDone(true);
    setMessage(res.message);
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>Reset Password</h1>
        <p className="login-subtitle">Enter your username — if the account has a registered email, a temporary password will be sent to it.</p>

        {message && <div className="login-error" style={{ background: 'var(--green-bg)', color: '#0a7a49' }}>{message}</div>}

        {!done && (
          <label>
            Username
            <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
          </label>
        )}

        {!done && <button type="submit" disabled={submitting}>{submitting ? 'Sending…' : 'Send Reset Email'}</button>}
        <button type="button" onClick={onBack} style={{ background: 'transparent', color: 'var(--text-soft)' }}>
          Back to sign in
        </button>
      </form>
    </div>
  );
}
