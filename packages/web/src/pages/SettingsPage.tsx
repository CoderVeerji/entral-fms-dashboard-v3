import { useEffect, useState, useCallback, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import * as api from '../api';
import type { AppSettingRow } from '../api';
import { SkeletonBlock } from '../components/SkeletonBlock';

export function SettingsPage() {
  const { token } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState<AppSettingRow[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    const res = await api.getAppSettings(token);
    setLoading(false);
    if (!res.ok) { setError(res.message); return; }
    setRows(res.data);
    const map: Record<string, string> = {};
    res.data.forEach((r) => { map[r.key] = r.value ?? ''; });
    setValues(map);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSaving(true);
    setError(null);
    const res = await api.saveAppSettings(token, values);
    setSaving(false);
    if (!res.ok) { setError(res.message); toast.error(res.message); return; }
    toast.success('Settings saved.');
    load();
  }

  if (loading) return <div className="card"><SkeletonBlock rows={6} /></div>;

  return (
    <div className="settings-page">
      <form className="card" onSubmit={handleSubmit} style={{ display: 'grid', gap: 14, maxWidth: 640 }}>
        {rows.map((r) => (
          <label key={r.key} style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-soft)' }}>
              {r.key.replace(/_/g, ' ')}
              {r.description && <span style={{ fontWeight: 400, textTransform: 'none' }}> — {r.description}</span>}
            </span>
            <input
              type="text" value={values[r.key] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [r.key]: e.target.value }))}
            />
          </label>
        ))}
        {error && <div className="login-error">{error}</div>}
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save Settings'}</button>
      </form>
    </div>
  );
}
