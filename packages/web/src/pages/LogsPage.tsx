import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import * as api from '../api';
import type { AuditLogRow, SyncLogRow } from '../api';

function AuditLogTable({ rows }: { rows: AuditLogRow[] }) {
  return (
    <div className="table-scroll">
      <table className="records-table">
        <thead>
          <tr><th>Time</th><th>User</th><th>Role</th><th>Action</th><th>Module</th><th>Result</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.logId}>
              <td>{new Date(r.timestamp).toLocaleString()}</td>
              <td>{r.username || '—'}</td>
              <td>{r.role || '—'}</td>
              <td>{r.action || '—'}</td>
              <td>{r.module || '—'}</td>
              <td>
                <span className={'badge badge-' + (r.success ? 'green' : 'red')}>{r.success ? 'OK' : 'Failed'}</span>
                {!r.success && r.errorMessage && <div style={{ fontSize: 11, color: 'var(--text-soft)', marginTop: 2 }}>{r.errorMessage}</div>}
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} className="empty-state">No audit log entries.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function SyncLogTable({ rows }: { rows: SyncLogRow[] }) {
  return (
    <div className="table-scroll">
      <table className="records-table">
        <thead>
          <tr><th>Started</th><th>FMS</th><th>Status</th><th>Rows Read</th><th>Duration</th><th>Triggered By</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.syncId}>
              <td>{new Date(r.startedAt).toLocaleString()}</td>
              <td>{r.fmsId}</td>
              <td><span className={'badge badge-' + (r.status === 'SUCCESS' ? 'green' : 'red')}>{r.status}</span></td>
              <td>{r.rowsRead}</td>
              <td>{r.durationMs != null ? `${(r.durationMs / 1000).toFixed(1)}s` : '—'}</td>
              <td>{r.triggeredBy || '—'}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} className="empty-state">No sync log entries.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export function LogsPage() {
  const { token } = useAuth();
  const [view, setView] = useState<'audit' | 'sync'>('audit');
  const [auditRows, setAuditRows] = useState<AuditLogRow[]>([]);
  const [syncRows, setSyncRows] = useState<SyncLogRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    if (view === 'audit') {
      const res = await api.getAuditLog(token, { limit: 200 });
      if (res.ok) setAuditRows(res.data); else setError(res.message);
    } else {
      const res = await api.getSyncLog(token, { limit: 200 });
      if (res.ok) setSyncRows(res.data); else setError(res.message);
    }
  }, [token, view]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="logs-page">
      <div className="filter-bar">
        <div style={{ display: 'flex', gap: 4 }}>
          <button className={view === 'audit' ? 'tab-active' : ''} onClick={() => setView('audit')}>Audit Log</button>
          <button className={view === 'sync' ? 'tab-active' : ''} onClick={() => setView('sync')}>Sync Log</button>
        </div>
      </div>
      {error && <div className="login-error">{error}</div>}
      {view === 'audit' ? <AuditLogTable rows={auditRows} /> : <SyncLogTable rows={syncRows} />}
    </div>
  );
}
