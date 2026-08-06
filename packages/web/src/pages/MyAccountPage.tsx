import { useState, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import * as api from '../api';
import { applyTheme, getStoredTheme, applyAccent, getStoredAccent, ACCENT_PRESETS, type Accent } from '../theme';
import { ChangePasswordScreen } from './ChangePasswordScreen';

export function MyAccountPage() {
  const { token, user, refreshUser } = useAuth();
  const toast = useToast();
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState(getStoredTheme());
  const [accent, setAccent] = useState(getStoredAccent());
  const [showChangePassword, setShowChangePassword] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSaving(true);
    setError(null);
    const res = await api.updateMyAccount(token, { fullName, email });
    setSaving(false);
    if (!res.ok) { setError(res.message); toast.error(res.message); return; }
    toast.success('Profile updated.');
    refreshUser();
  }

  function changeTheme(next: 'light' | 'dark') {
    setTheme(next);
    applyTheme(next);
  }

  function changeAccent(next: Accent) {
    setAccent(next);
    applyAccent(next);
  }

  return (
    <div className="my-account-page" style={{ display: 'grid', gap: 18, maxWidth: 640 }}>
      <form className="card" onSubmit={handleSubmit} style={{ display: 'grid', gap: 12 }}>
        <div className="section-title" style={{ marginBottom: 0 }}><i className="fas fa-id-card" />Profile</div>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-soft)', textTransform: 'uppercase' }}>Username</span>
          <input type="text" value={user?.username ?? ''} disabled style={{ opacity: 0.6 }} />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-soft)', textTransform: 'uppercase' }}>Full Name</span>
          <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-soft)', textTransform: 'uppercase' }}>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {error && <div className="login-error">{error}</div>}
        <div>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save Profile'}</button>
        </div>
      </form>

      <div className="card">
        <div className="section-title"><i className="fas fa-key" />Security</div>
        <button className="btn btn-outline" onClick={() => setShowChangePassword(true)}><i className="fas fa-lock" /> Change Password</button>
      </div>

      <div className="card">
        <div className="section-title"><i className="fas fa-palette" />Appearance</div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-soft)', marginBottom: 8, textTransform: 'uppercase' }}>Theme</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className={'btn btn-sm ' + (theme === 'light' ? 'btn-primary' : 'btn-outline')} onClick={() => changeTheme('light')}>
              <i className="fas fa-sun" /> Light
            </button>
            <button className={'btn btn-sm ' + (theme === 'dark' ? 'btn-primary' : 'btn-outline')} onClick={() => changeTheme('dark')}>
              <i className="fas fa-moon" /> Dark
            </button>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-soft)', marginBottom: 8, textTransform: 'uppercase' }}>Accent Color</div>
          <div style={{ display: 'flex', gap: 12 }}>
            {ACCENT_PRESETS.map((preset) => (
              <button
                key={preset.id} onClick={() => changeAccent(preset.id)} title={preset.label}
                style={{
                  width: 36, height: 36, borderRadius: '50%', background: preset.swatch, border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
                  outline: accent === preset.id ? '3px solid var(--navy)' : 'none', outlineOffset: 2,
                }}
              >
                {accent === preset.id && <i className="fas fa-check" style={{ fontSize: 13 }} />}
              </button>
            ))}
          </div>
        </div>
      </div>

      {showChangePassword && (
        <ChangePasswordScreen forced={false} onDone={() => setShowChangePassword(false)} onCancel={() => setShowChangePassword(false)} />
      )}
    </div>
  );
}
