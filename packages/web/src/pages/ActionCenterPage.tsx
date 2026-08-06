import { useEffect, useState, useCallback, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../components/ConfirmDialog';
import * as api from '../api';
import type { FmsConfig, ActionItem, ActionComment } from '../api';
import { StatusBadge } from '../components/StatusBadge';
import { EmptyState } from '../components/EmptyState';
import { SkeletonBlock } from '../components/SkeletonBlock';
import { useDebouncedValue } from '../hooks/useDebouncedValue';

const ACTION_TYPES = ['Follow-up', 'Correction', 'Escalation', 'Review', 'Data Update', 'Management Decision', 'Other'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];
const STATUSES = ['Open', 'In Progress', 'Waiting', 'Resolved', 'Cancelled'];

function NewActionForm({ fmsList, onCreated, onCancel }: { fmsList: FmsConfig[]; onCreated: () => void; onCancel: () => void }) {
  const { token } = useAuth();
  const toast = useToast();
  const [fmsId, setFmsId] = useState(fmsList[0]?.fmsId ?? '');
  const [title, setTitle] = useState('');
  const [actionType, setActionType] = useState(ACTION_TYPES[0]);
  const [priority, setPriority] = useState('Medium');
  const [assignedTo, setAssignedTo] = useState('');
  const [assignedEmail, setAssignedEmail] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSubmitting(true);
    setError(null);
    const res = await api.saveActionItem(token, { fmsId, title, actionType, priority, assignedTo, assignedEmail, description });
    setSubmitting(false);
    if (!res.ok) { setError(res.message); toast.error(res.message); return; }
    toast.success('Action item created.');
    onCreated();
  }

  return (
    <form className="card" onSubmit={handleSubmit} style={{ marginBottom: 18, display: 'grid', gap: 10 }}>
      <div className="filter-bar" style={{ marginBottom: 0 }}>
        <select value={fmsId} onChange={(e) => setFmsId(e.target.value)}>
          {fmsList.map((f) => <option key={f.fmsId} value={f.fmsId}>{f.fmsName}</option>)}
        </select>
        <select value={actionType} onChange={(e) => setActionType(e.target.value)}>
          {ACTION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={priority} onChange={(e) => setPriority(e.target.value)}>
          {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <input type="text" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} required />
      <div className="filter-bar" style={{ marginBottom: 0 }}>
        <input type="text" placeholder="Assigned to (name)" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} />
        <input type="email" placeholder="Assigned email" value={assignedEmail} onChange={(e) => setAssignedEmail(e.target.value)} />
      </div>
      <textarea placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="input-el" />
      {error && <div className="login-error">{error}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Creating…' : 'Create Action'}</button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function ActionRow({ action, onChanged }: { action: ActionItem; onChanged: () => void }) {
  const { token, user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [expanded, setExpanded] = useState(false);
  const [comments, setComments] = useState<ActionComment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [busy, setBusy] = useState(false);

  async function loadComments() {
    if (!token) return;
    const res = await api.getActionComments(token, action.actionId);
    if (res.ok) setComments(res.data);
  }

  function toggle() {
    const next = !expanded;
    setExpanded(next);
    if (next) loadComments();
  }

  async function addComment() {
    if (!token || !newComment.trim()) return;
    setBusy(true);
    const res = await api.saveActionComment(token, action.actionId, newComment.trim());
    setBusy(false);
    if (!res.ok) { toast.error(res.message); return; }
    setNewComment('');
    loadComments();
  }

  async function setStatus(status: string) {
    if (!token) return;
    setBusy(true);
    const res = await api.updateActionStatus(token, action.actionId, status);
    setBusy(false);
    if (!res.ok) { toast.error(res.message); return; }
    toast.success(`Marked ${status}.`);
    onChanged();
  }

  async function deleteAction() {
    if (!token) return;
    const ok = await confirm({
      title: 'Delete action item?', danger: true, confirmLabel: 'Delete',
      message: `"${action.title}" will be permanently removed. This cannot be undone.`,
    });
    if (!ok) return;
    setBusy(true);
    const res = await api.deleteActionItem(token, action.actionId);
    setBusy(false);
    if (!res.ok) { toast.error(res.message); return; }
    toast.success('Action item deleted.');
    onChanged();
  }

  async function sendReminder() {
    if (!token || !action.assignedEmail) return;
    setBusy(true);
    const res = await api.sendActionReminder(token, action.actionId, {
      email: action.assignedEmail, recordDisplay: action.recordDisplay ?? undefined, stageName: action.stageName ?? undefined,
    });
    setBusy(false);
    if (!res.ok) { toast.error(res.message); return; }
    toast.success(`Reminder sent to ${action.assignedEmail}.`);
  }

  return (
    <>
      <tr className="row-clickable" onClick={toggle}>
        <td>{action.title}</td>
        <td>{action.recordDisplay || '—'}</td>
        <td><StatusBadge status={action.priority} /></td>
        <td>{action.actionType}</td>
        <td>{action.assignedTo || '—'}</td>
        <td><StatusBadge status={action.status} /></td>
        <td>{new Date(action.createdAt).toLocaleDateString()}</td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={7} style={{ background: 'var(--surface-alt)', padding: 16 }}>
            {action.description && <div style={{ marginBottom: 10, fontSize: 13 }}>{action.description}</div>}
            {action.status !== 'Resolved' && action.status !== 'Cancelled' && (
              <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
                {STATUSES.filter((s) => s !== action.status).map((s) => (
                  <button key={s} className="btn btn-outline btn-sm" disabled={busy} onClick={(e) => { e.stopPropagation(); setStatus(s); }}>{s}</button>
                ))}
                <button
                  className="btn btn-outline btn-sm" disabled={busy || !action.assignedEmail}
                  title={action.assignedEmail ? `Email ${action.assignedEmail}` : 'No email on file for this action'}
                  onClick={(e) => { e.stopPropagation(); sendReminder(); }}
                >
                  <i className="fas fa-paper-plane" /> Send Reminder
                </button>
              </div>
            )}
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-soft)', marginBottom: 6 }}>COMMENTS</div>
            {comments.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-soft)', marginBottom: 8 }}>No comments yet.</div>}
            {comments.map((c) => (
              <div key={c.commentId} style={{ fontSize: 12.5, marginBottom: 6 }}>
                <b>{c.createdBy}</b> · {new Date(c.createdAt).toLocaleString()}<br />{c.comment}
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
              <input type="text" placeholder="Add a comment…" value={newComment} onChange={(e) => setNewComment(e.target.value)} style={{ flex: 1 }} />
              <button className="btn btn-primary btn-sm" disabled={busy || !newComment.trim()} onClick={addComment}>Post</button>
            </div>
            {user?.roleId === 'SUPER_ADMIN' && (
              <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                <button className="btn btn-danger btn-sm" disabled={busy} onClick={(e) => { e.stopPropagation(); deleteAction(); }}>
                  <i className="fas fa-trash" /> Delete Action
                </button>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export function ActionCenterPage() {
  const { token } = useAuth();
  const [fmsList, setFmsList] = useState<FmsConfig[]>([]);
  const [fmsId, setFmsId] = useState('');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [rows, setRows] = useState<ActionItem[]>([]);
  const [showNewForm, setShowNewForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    api.getFmsList(token).then((res) => { if (res.ok) setFmsList(res.data); });
  }, [token]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    const res = await api.getActionItems(token, { fmsId: fmsId || undefined, status: status || undefined, priority: priority || undefined, search: debouncedSearch || undefined });
    setLoading(false);
    if (!res.ok) { setError(res.message); return; }
    setRows(res.data);
  }, [token, fmsId, status, priority, debouncedSearch]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="action-center-page">
      <div className="filter-bar">
        <input type="text" placeholder="Search title or record…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={fmsId} onChange={(e) => setFmsId(e.target.value)}>
          <option value="">All FMS</option>
          {fmsList.map((f) => <option key={f.fmsId} value={f.fmsId}>{f.fmsName}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Any Status</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="">Any Priority</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <button className="btn btn-primary" onClick={() => setShowNewForm((v) => !v)} style={{ marginLeft: 'auto' }}>
          <i className={'fas ' + (showNewForm ? 'fa-xmark' : 'fa-plus')} /> {showNewForm ? 'Close' : 'New Action'}
        </button>
      </div>

      {showNewForm && fmsList.length > 0 && (
        <NewActionForm fmsList={fmsList} onCreated={() => { setShowNewForm(false); load(); }} onCancel={() => setShowNewForm(false)} />
      )}

      {error && <div className="login-error">{error}</div>}

      {loading && rows.length === 0 ? (
        <div className="card"><SkeletonBlock rows={5} /></div>
      ) : (
        <div className="table-scroll">
          <table className="records-table">
            <thead>
              <tr><th>Title</th><th>Record</th><th>Priority</th><th>Type</th><th>Assigned</th><th>Status</th><th>Created</th></tr>
            </thead>
            <tbody>
              {rows.map((a) => <ActionRow key={a.actionId} action={a} onChanged={load} />)}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={7} style={{ padding: 0 }}>
                  <EmptyState icon="fa-list-check" title="No action items match these filters"
                    action={<button className="btn btn-primary btn-sm" onClick={() => setShowNewForm(true)}><i className="fas fa-plus" /> New Action</button>} />
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
