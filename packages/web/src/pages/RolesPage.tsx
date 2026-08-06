import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import * as api from '../api';
import type { RoleRow } from '../api';
import { SkeletonBlock } from '../components/SkeletonBlock';

// Mirrors @fms/core's PERMISSIONS list (packages/core/src/constants.ts) — kept as a plain array
// here rather than adding a new cross-package dependency just for one static string list.
const PERMISSIONS = [
  'dashboard.view', 'fms.view', 'fms.manage', 'records.view', 'actions.view', 'actions.add', 'actions.edit',
  'actions.close', 'actions.delete', 'reports.view', 'reports.export', 'users.view', 'users.add',
  'users.edit', 'users.delete', 'roles.view', 'roles.edit', 'settings.view', 'settings.edit', 'audit.view',
  'sync.run', 'ai.chat',
];

export function RolesPage() {
  const { token } = useAuth();
  const toast = useToast();
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [editing, setEditing] = useState<Record<string, Record<string, boolean>>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    const res = await api.getRoles(token);
    setLoading(false);
    if (!res.ok) { setError(res.message); return; }
    setRoles(res.data);
    const initial: Record<string, Record<string, boolean>> = {};
    res.data.forEach((r) => { initial[r.roleId] = { ...r.permissions }; });
    setEditing(initial);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  function toggle(roleId: string, perm: string) {
    setEditing((prev) => ({ ...prev, [roleId]: { ...prev[roleId], [perm]: !prev[roleId]?.[perm] } }));
  }

  async function save(roleId: string) {
    if (!token) return;
    setSaving(roleId);
    setError(null);
    const res = await api.saveRolePermissions(token, roleId, editing[roleId] || {});
    setSaving(null);
    if (!res.ok) { toast.error(res.message); return; }
    toast.success('Permissions saved.');
    load();
  }

  if (loading) return <div className="card"><SkeletonBlock rows={6} /></div>;

  return (
    <div className="roles-page">
      {error && <div className="login-error">{error}</div>}
      {roles.map((role) => (
        <div className="card" key={role.roleId} style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontWeight: 800, color: 'var(--navy)' }}>{role.roleName}</div>
            <button className="btn btn-primary btn-sm" disabled={saving === role.roleId} onClick={() => save(role.roleId)}>
              {saving === role.roleId ? 'Saving…' : 'Save'}
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
            {PERMISSIONS.map((perm) => (
              <label key={perm} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                <input
                  type="checkbox"
                  checked={!!editing[role.roleId]?.[perm]}
                  disabled={role.roleId === 'SUPER_ADMIN'}
                  onChange={() => toggle(role.roleId, perm)}
                />
                {perm}
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
