import { useEffect, useState, useCallback, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../components/ConfirmDialog';
import * as api from '../api';
import type { AdminUser, RoleRow } from '../api';
import { EmptyState } from '../components/EmptyState';
import { SkeletonBlock } from '../components/SkeletonBlock';
import { formatDateTime } from '../utils/date';

function NewUserForm({ roles, onCreated, onCancel }: { roles: RoleRow[]; onCreated: (tempPassword: string) => void; onCancel: () => void }) {
  const { token } = useAuth();
  const toast = useToast();
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState(roles[0]?.roleId ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSubmitting(true);
    setError(null);
    const res = await api.saveUser(token, { username, fullName, email, roleId });
    setSubmitting(false);
    if (!res.ok) { setError(res.message); toast.error(res.message); return; }
    if (typeof res.data === 'object' && res.data && 'tempPassword' in res.data) onCreated(res.data.tempPassword);
  }

  return (
    <form className="card" onSubmit={handleSubmit} style={{ marginBottom: 18, display: 'grid', gap: 10 }}>
      <div className="filter-bar" style={{ marginBottom: 0 }}>
        <input type="text" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} required />
        <input type="text" placeholder="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
          {roles.map((r) => <option key={r.roleId} value={r.roleId}>{r.roleName}</option>)}
        </select>
      </div>
      {error && <div className="login-error">{error}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Creating…' : 'Create User'}</button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export function UsersPage() {
  const { token } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [rows, setRows] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [showNewForm, setShowNewForm] = useState(false);
  const [tempPasswordNotice, setTempPasswordNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    const [usersRes, rolesRes] = await Promise.all([api.getUsers(token), api.getRoles(token)]);
    setLoading(false);
    if (usersRes.ok) setRows(usersRes.data); else setError(usersRes.message);
    if (rolesRes.ok) setRoles(rolesRes.data);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function toggleActive(u: AdminUser) {
    if (!token) return;
    if (u.status === 'ACTIVE') {
      const ok = await confirm({
        title: 'Deactivate user?', danger: true, confirmLabel: 'Deactivate',
        message: `"${u.username}" will immediately lose access — their active sessions are not revoked automatically, but they won't be able to sign in again.`,
      });
      if (!ok) return;
    }
    const res = await api.setUserStatus(token, u.userId, u.status !== 'ACTIVE');
    if (!res.ok) { toast.error(res.message); return; }
    toast.success(u.status === 'ACTIVE' ? 'User deactivated.' : 'User activated.');
    load();
  }

  async function unlock(u: AdminUser) {
    if (!token) return;
    const res = await api.unlockUser(token, u.userId);
    if (!res.ok) { toast.error(res.message); return; }
    toast.success('Account unlocked.');
    load();
  }

  async function resetPassword(u: AdminUser) {
    if (!token) return;
    const ok = await confirm({
      title: 'Reset password?', confirmLabel: 'Reset',
      message: `"${u.username}"'s current password will stop working immediately, replaced by a new temporary one shown only once.`,
    });
    if (!ok) return;
    const res = await api.resetUserPassword(token, u.userId);
    if (!res.ok) { toast.error(res.message); return; }
    setTempPasswordNotice(`New temporary password for ${u.username}: ${res.data.tempPassword}`);
  }

  return (
    <div className="users-page">
      <div className="filter-bar">
        <button className="btn btn-primary" onClick={() => setShowNewForm((v) => !v)} style={{ marginLeft: 'auto' }}>
          <i className={'fas ' + (showNewForm ? 'fa-xmark' : 'fa-plus')} /> {showNewForm ? 'Close' : 'New User'}
        </button>
      </div>

      {showNewForm && roles.length > 0 && (
        <NewUserForm roles={roles} onCancel={() => setShowNewForm(false)} onCreated={(tp) => {
          setShowNewForm(false);
          setTempPasswordNotice(`Temporary password: ${tp}`);
          toast.success('User created.');
          load();
        }} />
      )}

      {tempPasswordNotice && (
        <div className="login-error" style={{ background: 'var(--green-bg)', color: '#0a7a49', marginBottom: 14 }}>
          {tempPasswordNotice} — share this securely, it will not be shown again.
        </div>
      )}
      {error && <div className="login-error">{error}</div>}

      {loading ? (
        <div className="card"><SkeletonBlock rows={5} /></div>
      ) : (
        <div className="table-scroll">
          <table className="records-table">
            <thead>
              <tr><th>Username</th><th>Full Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last Login</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.userId}>
                  <td>{u.username}</td>
                  <td>{u.fullName || '—'}</td>
                  <td>{u.email || '—'}</td>
                  <td>{u.roleName || u.roleId}</td>
                  <td><span className={'badge badge-' + (u.status === 'ACTIVE' ? 'green' : 'grey')}>{u.status}</span></td>
                  <td>{u.lastLogin ? formatDateTime(u.lastLogin) : 'Never'}</td>
                  <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button className="btn btn-outline btn-sm" onClick={() => toggleActive(u)}>{u.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}</button>
                    <button className="btn btn-outline btn-sm" onClick={() => unlock(u)}>Unlock</button>
                    <button className="btn btn-outline btn-sm" onClick={() => resetPassword(u)}>Reset Password</button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={7} style={{ padding: 0 }}>
                  <EmptyState icon="fa-user-gear" title="No users found"
                    action={<button className="btn btn-primary btn-sm" onClick={() => setShowNewForm(true)}><i className="fas fa-plus" /> New User</button>} />
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
