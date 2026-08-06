import { useEffect, useState, useCallback, useRef, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../components/ConfirmDialog';
import { Modal } from '../components/Modal';
import { EmptyState } from '../components/EmptyState';
import { SkeletonBlock } from '../components/SkeletonBlock';
import * as api from '../api';
import type { FmsConfig } from '../api';

// Port of app/index.html's FmsModal — auto-derives Short Name from FMS Name until the user
// manually edits Short Name themselves (then stops overwriting it).
function FmsFormModal({ initial, onClose, onSaved }: { initial: FmsConfig | null; onClose: () => void; onSaved: () => void }) {
  const { token } = useAuth();
  const toast = useToast();
  const [fmsName, setFmsName] = useState(initial?.fmsName ?? '');
  const [shortName, setShortName] = useState(initial?.shortName ?? '');
  const [spreadsheetId, setSpreadsheetId] = useState(initial?.spreadsheetId ?? '');
  const [statusCacheSheetName, setStatusCacheSheetName] = useState(initial?.statusCacheSheetName ?? 'Status_Cache');
  const [category, setCategory] = useState(initial?.category ?? '');
  const [ownerName, setOwnerName] = useState(initial?.ownerName ?? '');
  const [ownerEmail, setOwnerEmail] = useState(initial?.ownerEmail ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const shortNameTouched = useRef(!!initial);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleFmsNameChange(v: string) {
    setFmsName(v);
    if (!shortNameTouched.current) {
      setShortName(v.split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 6));
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSubmitting(true);
    setError(null);
    const res = await api.saveFmsConfig(token, {
      fmsId: initial?.fmsId, fmsName, shortName, spreadsheetId, statusCacheSheetName,
      category, ownerName, ownerEmail, notes,
    });
    setSubmitting(false);
    if (!res.ok) { setError(res.message); toast.error(res.message); return; }
    toast.success(initial ? 'FMS updated.' : 'FMS connected.');
    onSaved();
  }

  return (
    <Modal title={initial ? 'Edit FMS Connection' : 'Add FMS Connection'} onClose={onClose} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={submitting} onClick={handleSubmit}>{submitting ? 'Saving…' : 'Save'}</button>
      </>
    }>
      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 12 }}>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-soft)', textTransform: 'uppercase' }}>FMS Name</span>
          <input type="text" value={fmsName} onChange={(e) => handleFmsNameChange(e.target.value)} required autoFocus />
        </label>
        <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-soft)', textTransform: 'uppercase' }}>Short Name</span>
            <input type="text" value={shortName} onChange={(e) => { shortNameTouched.current = true; setShortName(e.target.value); }} />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-soft)', textTransform: 'uppercase' }}>Category</span>
            <input type="text" value={category} onChange={(e) => setCategory(e.target.value)} />
          </label>
        </div>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-soft)', textTransform: 'uppercase' }}>Google Sheet ID</span>
          <input type="text" value={spreadsheetId} onChange={(e) => setSpreadsheetId(e.target.value)} required placeholder="From the sheet's URL" />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-soft)', textTransform: 'uppercase' }}>Status Cache Sheet Name</span>
          <input type="text" value={statusCacheSheetName} onChange={(e) => setStatusCacheSheetName(e.target.value)} />
        </label>
        <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-soft)', textTransform: 'uppercase' }}>Owner Name</span>
            <input type="text" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-soft)', textTransform: 'uppercase' }}>Owner Email</span>
            <input type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} />
          </label>
        </div>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-soft)', textTransform: 'uppercase' }}>Notes</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </label>
        {error && <div className="login-error">{error}</div>}
      </form>
    </Modal>
  );
}

export function FmsSourcesPage() {
  const { token } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [rows, setRows] = useState<FmsConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<FmsConfig | null | 'new'>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    const res = await api.getFmsList(token);
    setLoading(false);
    if (!res.ok) { setError(res.message); return; }
    setRows(res.data);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function toggleActive(f: FmsConfig) {
    if (!token) return;
    if (f.active) {
      const ok = await confirm({
        title: 'Deactivate FMS?', danger: true, confirmLabel: 'Deactivate',
        message: `"${f.fmsName}" will stop syncing and disappear from Live Records/Dashboard filters until reactivated.`,
      });
      if (!ok) return;
    }
    const res = await api.setFmsActive(token, f.fmsId, !f.active);
    if (!res.ok) { toast.error(res.message); return; }
    toast.success(f.active ? 'FMS deactivated.' : 'FMS activated.');
    load();
  }

  return (
    <div className="fms-sources-page">
      <div className="filter-bar">
        <button className="btn btn-primary" onClick={() => setEditing('new')} style={{ marginLeft: 'auto' }}>
          <i className="fas fa-plus" /> Add FMS
        </button>
      </div>

      {error && <div className="login-error">{error}</div>}

      {loading ? (
        <div className="card"><SkeletonBlock rows={4} /></div>
      ) : rows.length === 0 ? (
        <div className="card">
          <EmptyState icon="fa-plug" title="No FMS connected yet" subtitle="Add your first FMS connection to start syncing records."
            action={<button className="btn btn-primary btn-sm" onClick={() => setEditing('new')}><i className="fas fa-plus" /> Add FMS</button>} />
        </div>
      ) : (
        <div className="table-scroll">
          <table className="records-table">
            <thead>
              <tr><th>FMS</th><th>Category</th><th>Owner</th><th>Last Sync</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.fmsId}>
                  <td><b>{f.fmsName}</b>{f.shortName && <span style={{ color: 'var(--text-soft)' }}> ({f.shortName})</span>}</td>
                  <td>{f.category || '—'}</td>
                  <td>{f.ownerName || '—'}</td>
                  <td>{f.lastSuccessfulSync ? new Date(f.lastSuccessfulSync).toLocaleString() : 'Never'}</td>
                  <td><span className={'badge badge-' + (f.active ? 'green' : 'grey')}>{f.active ? 'Active' : 'Inactive'}</span></td>
                  <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button className="btn btn-outline btn-sm" onClick={() => setEditing(f)}><i className="fas fa-pen" /> Edit</button>
                    <button className="btn btn-outline btn-sm" onClick={() => toggleActive(f)}>
                      {f.active ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <FmsFormModal
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}
