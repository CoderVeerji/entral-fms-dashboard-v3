import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import * as api from '../api';
import type { DataHealthIssue } from '../api';
import { formatDateTime } from '../utils/date';

const TYPE_LABELS: Record<string, string> = {
  DUPLICATE_RECORDS: 'Duplicate Records',
  SUSPICIOUS_DATE_MAPPING: 'Suspicious Date Mapping',
  NEGATIVE_DELAY: 'Negative Delay',
};

export function DataHealthPage() {
  const { token } = useAuth();
  const [issues, setIssues] = useState<DataHealthIssue[]>([]);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    api.getDataHealth(token).then((res) => {
      setLoading(false);
      if (!res.ok) return;
      setIssues(res.data.issues);
      setCheckedAt(res.data.checkedAt);
    });
  }, [token]);

  if (loading) return <div className="app-loading">Loading…</div>;

  return (
    <div className="data-health-page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div className="section-title" style={{ margin: 0 }}>
          <i className="fas fa-stethoscope" />
          {issues.length === 0 ? 'No issues found' : `${issues.length} issue${issues.length === 1 ? '' : 's'} found`}
        </div>
        <span style={{ fontSize: 12, color: 'var(--text-soft)' }}>
          {checkedAt ? `Last checked ${formatDateTime(checkedAt)}` : 'Not checked yet'}
        </span>
      </div>

      {issues.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--text-soft)', padding: 40 }}>
          <i className="fas fa-circle-check" style={{ fontSize: 32, color: 'var(--green)', marginBottom: 10, display: 'block' }} />
          Every connected FMS looks clean — no duplicate records, suspicious dates, or negative delays found.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {issues.map((issue, i) => (
            <div className="card" key={i}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span className="badge badge-red">{TYPE_LABELS[issue.type] || issue.type}</span>
                <span style={{ fontWeight: 700, color: 'var(--navy)' }}>{issue.fmsName}</span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-soft)', marginTop: 8, lineHeight: 1.5 }}>{issue.detail}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
