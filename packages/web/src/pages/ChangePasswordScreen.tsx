import { useState, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import * as api from '../api';

interface ChangePasswordScreenProps {
  // Forced (first login / admin reset): no current-password field (backend doesn't require one
  // when must_change_password is true — see packages/api/src/routes/auth.ts), no way to cancel
  // out of it. Voluntary (from the user menu): requires current password, can be closed.
  forced: boolean;
  onDone: () => void;
  onCancel?: () => void;
}

export function ChangePasswordScreen({ forced, onDone, onCancel }: ChangePasswordScreenProps) {
  const { token, markPasswordChanged } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 8) { setError('New password must be at least 8 characters.'); return; }
    if (newPassword !== confirmPassword) { setError('New password and confirmation do not match.'); return; }
    if (!token) return;

    setSubmitting(true);
    const res = await api.changePassword(token, forced ? undefined : currentPassword, newPassword);
    setSubmitting(false);
    if (!res.ok) { setError(res.message); return; }
    markPasswordChanged();
    onDone();
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>{forced ? 'Set a New Password' : 'Change Password'}</h1>
        <p className="login-subtitle">
          {forced
            ? "This is either your first login or an admin reset your password — you must set a new one before continuing."
            : 'Enter your current password and choose a new one.'}
        </p>

        {error && <div className="login-error">{error}</div>}

        {!forced && (
          <label>
            Current Password
            <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required autoFocus />
          </label>
        )}
        <label>
          New Password
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} autoFocus={forced} />
        </label>
        <label>
          Confirm New Password
          <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={8} />
        </label>

        <button type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Save New Password'}</button>
        {!forced && onCancel && (
          <button type="button" onClick={onCancel} style={{ background: 'transparent', color: 'var(--text-soft)', marginTop: -2 }}>Cancel</button>
        )}
      </form>
    </div>
  );
}
