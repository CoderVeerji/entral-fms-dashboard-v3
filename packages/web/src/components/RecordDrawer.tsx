import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import * as api from '../api';
import type { RecordRow, StageEvent, ActionItem } from '../api';
import { Drawer } from './Drawer';
import { EmptyState } from './EmptyState';
import { SkeletonBlock } from './SkeletonBlock';
import { StatusBadge } from './StatusBadge';
import { ProgressBar } from './ProgressBar';
import { Stepper } from './Stepper';
import { DetailValue } from './DetailValue';
import { copyToClipboard } from '../utils/clipboard';

type Tab = 'overview' | 'details' | 'timeline' | 'actions';

interface NewActionDraft { stageName: string; title: string }

// Port of app/index.html's RecordDrawer — click a Live Records / Update Health row and it slides
// in from the right with a tabbed view of that one record, instead of nothing happening (the gap
// the v1 app never had: every row was clickable and opened this exact drawer).
export function RecordDrawer({ fmsId, recordId, onClose }: { fmsId: string; recordId: string; onClose: () => void }) {
  const { token } = useAuth();
  const toast = useToast();
  const [record, setRecord] = useState<RecordRow | null>(null);
  const [stages, setStages] = useState<StageEvent[]>([]);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [draft, setDraft] = useState<NewActionDraft | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoadError(null);
    const res = await api.getRecordDetail(token, fmsId, recordId);
    if (res.ok) { setRecord(res.data.record); setStages(res.data.stages); setActions(res.data.actions); }
    else setLoadError(res.message);
  }, [token, fmsId, recordId]);

  useEffect(() => { load(); }, [load]);

  async function createAction() {
    if (!token || !draft) return;
    setSubmitting(true);
    const res = await api.saveActionItem(token, {
      fmsId, recordId, recordDisplay: record?.displayName || recordId, stageName: draft.stageName,
      actionType: 'Follow-up', priority: 'Medium', title: draft.title,
    });
    setSubmitting(false);
    if (!res.ok) { toast.error(res.message); return; }
    toast.success('Action created.');
    setDraft(null);
    load();
  }

  async function copySummary() {
    if (!record) return;
    const lines = [
      `${record.displayName || record.recordId} (${record.recordId})`,
      `FMS: ${record.fmsId}`,
      `Stage: ${record.currentStage || '—'}`,
      `Status: ${record.recordStatus}`,
      `Doer: ${record.doer || '—'}`,
      `Plan Time: ${record.planTime ? new Date(record.planTime).toLocaleString() : '—'}`,
      `Delay: ${record.delay?.human || 'None'}`,
      `Last Update: ${record.lastUpdate ? new Date(record.lastUpdate).toLocaleString() : 'Never'}`,
    ];
    const success = await copyToClipboard(lines.join('\n'));
    if (success) toast.success('Record summary copied.');
    else toast.error('Could not copy to clipboard.');
  }

  async function resolveAction(actionId: string) {
    if (!token) return;
    const res = await api.updateActionStatus(token, actionId, 'Resolved');
    if (!res.ok) { toast.error(res.message); return; }
    toast.success('Action resolved.');
    load();
  }

  if (loadError) {
    return (
      <Drawer onClose={onClose}>
        <div style={{ padding: 22 }}>
          <EmptyState icon="fa-triangle-exclamation" title="Could not load this record" subtitle={loadError}
            action={<button className="btn btn-primary" onClick={load}><i className="fas fa-rotate-right" /> Retry</button>} />
        </div>
      </Drawer>
    );
  }
  if (!record) return <Drawer onClose={onClose}><div style={{ padding: 22 }}><SkeletonBlock rows={8} /></div></Drawer>;

  return (
    <Drawer onClose={onClose}>
      <div className="drawer-head">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--navy)' }}>{record.displayName || record.recordId}</div>
            <div style={{ fontSize: 12, color: 'var(--text-soft)' }}>{record.fmsId} · {record.recordId}</div>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="close-x" title="Copy summary" onClick={copySummary}><i className="fas fa-copy" /></button>
            <button className="close-x" onClick={onClose}><i className="fas fa-xmark" /></button>
          </div>
        </div>
      </div>
      <div className="drawer-tabs">
        {(['overview', 'details', 'timeline', 'actions'] as Tab[]).map((t) => (
          <button key={t} className={'drawer-tab' + (tab === t ? ' active' : '')} onClick={() => setTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      <div className="drawer-body">
        {tab === 'overview' && (
          <div>
            <div className="stat-row"><span>Current Stage</span><b>{record.currentStage || '—'}</b></div>
            <div className="stat-row"><span>Status</span><StatusBadge status={record.recordStatus} /></div>
            <div className="stat-row"><span>Responsible</span><b>{record.doer || '—'}</b></div>
            <div className="stat-row"><span>Plan Time</span><b>{record.planTime ? new Date(record.planTime).toLocaleString() : '—'}</b></div>
            <div className="stat-row"><span>Delay</span><b style={{ color: record.delay ? 'var(--red)' : 'inherit' }}>{record.delay?.human || 'None'}</b></div>
            <div className="stat-row"><span>Last Update</span><b>{record.lastUpdate ? new Date(record.lastUpdate).toLocaleString() : 'Never'}</b></div>
            <div className="stat-row"><span>Freshness</span><StatusBadge status={record.freshness} /></div>
            {record.sequenceException && (
              <div style={{ marginTop: 10 }}>
                <span className="badge badge-grey"><i className="fas fa-forward" /> Some steps skipped (normal for this record's flow)</span>
              </div>
            )}
            <div style={{ marginTop: 14 }}>
              <ProgressBar percent={record.totalSteps ? Math.round(((record.completedSteps || 0) / record.totalSteps) * 100) : 0} />
              <div style={{ fontSize: 11.5, color: 'var(--text-soft)' }}>{record.completedSteps || 0} of {record.totalSteps || 0} stages completed</div>
            </div>
            <div style={{ marginTop: 16 }}>
              <button className="btn btn-primary" onClick={() => setDraft({ stageName: record.currentStage || '', title: `Follow up: ${record.displayName || record.recordId}` })}>
                <i className="fas fa-plus" /> Create Action
              </button>
            </div>
          </div>
        )}
        {tab === 'details' && (
          !record.details || Object.keys(record.details).length === 0
            ? <EmptyState icon="fa-file-lines" title="No details available for this record"
                subtitle="This FMS may still be running an older publisher script that doesn't send these fields yet." />
            : <div>
                {Object.entries(record.details).map(([key, value]) => (
                  <div key={key} className="stat-row"><span>{key}</span><DetailValue value={value} /></div>
                ))}
              </div>
        )}
        {tab === 'timeline' && (
          stages.length === 0
            ? <EmptyState icon="fa-timeline" title="No stage history yet" />
            : <Stepper
                items={stages.map((s) => ({
                  sequence: s.stageIndex + 1, stageName: s.stageName, doerName: s.doerName, doerEmail: s.doerEmail,
                  status: s.status, planTime: s.planTime, actualTime: s.actualTime, varianceMinutes: s.varianceMinutes,
                }))}
                onCreateAction={(s) => setDraft({ stageName: s.stageName, title: `Follow up: ${s.stageName}` })}
              />
        )}
        {tab === 'actions' && (
          actions.length === 0
            ? <EmptyState icon="fa-list-check" title="No actions yet for this record" />
            : <div>
                {actions.map((a) => (
                  <div key={a.actionId} className="card" style={{ marginBottom: 10, padding: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><b>{a.title}</b><StatusBadge status={a.status} /></div>
                    <div style={{ fontSize: 12, color: 'var(--text-soft)', marginTop: 4 }}>{a.actionType} · {a.priority} · Assigned: {a.assignedTo || 'Unassigned'}</div>
                    {a.description && <div style={{ fontSize: 12.5, marginTop: 6 }}>{a.description}</div>}
                    {a.status !== 'Resolved' && a.status !== 'Cancelled' && (
                      <div style={{ marginTop: 8 }}>
                        <button className="btn btn-success btn-sm" onClick={() => resolveAction(a.actionId)}><i className="fas fa-check" /> Resolve</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
        )}

        {draft && (
          <div className="card" style={{ marginTop: 16, padding: 14 }}>
            <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 13 }}>New Action</div>
            <input type="text" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} style={{ width: '100%', marginBottom: 8 }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary btn-sm" disabled={submitting} onClick={createAction}>{submitting ? 'Creating…' : 'Create'}</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setDraft(null)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}
