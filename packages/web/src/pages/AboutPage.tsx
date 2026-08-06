import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import * as api from '../api';
import type { RoleRow } from '../api';

const RECORD_STATUSES: [string, string][] = [
  ['NOT_STARTED', 'No stage has begun yet.'],
  ['RUNNING_ON_TIME', 'Current stage is on track against its plan time.'],
  ['AT_RISK', 'Current stage\'s plan time is within the "at risk" window (default 4 hours).'],
  ['OVERDUE', 'Current stage has passed its plan time with no actual yet.'],
  ['STALLED', 'Current stage has no plan time at all and has sat untouched long enough to be Stale/Critical — same urgency as Overdue, different cause.'],
  ['COMPLETED_ON_TIME', 'Every stage is done, none finished late.'],
  ['COMPLETED_LATE', 'Every stage is done, at least one finished late.'],
  ['DATA_EXCEPTION', 'A stage has an unparseable plan/actual date — usually a source data typo.'],
];

const FRESHNESS_LEVELS: [string, string][] = [
  ['Fresh', 'Updated within the warning window (default 24h).'],
  ['Warning', 'No update for longer than the warning window.'],
  ['Stale', 'No update for longer than the critical window (default 72h).'],
  ['Critical', 'No update for more than twice the critical window.'],
  ['Never', 'This record has never had an operational update.'],
];

export function AboutPage() {
  const { token } = useAuth();
  const [roles, setRoles] = useState<RoleRow[]>([]);

  useEffect(() => {
    if (!token) return;
    api.getRoles(token).then((res) => { if (res.ok) setRoles(res.data); });
  }, [token]);

  const permissions = Array.from(new Set(roles.flatMap((r) => Object.keys(r.permissions)))).sort();

  return (
    <div className="about-page" style={{ display: 'grid', gap: 18 }}>
      <div className="card">
        <div className="section-title"><i className="fas fa-circle-info" />What this dashboard does</div>
        <p style={{ fontSize: 13.5, lineHeight: 1.7, color: 'var(--text)' }}>
          Central FMS Management Dashboard tracks records across every connected FMS (Flow Management System) spreadsheet
          from one place. Each connected FMS runs its own small script that evaluates every record's current stage,
          status, and freshness on its own schedule and writes the result to that FMS's own Status_Cache sheet — this
          dashboard only ever reads that already-computed cache, never the FMS's raw working data, and never writes
          anything back to it.
        </p>
      </div>

      <div className="card">
        <div className="section-title"><i className="fas fa-flag" />Record Status</div>
        {RECORD_STATUSES.map(([status, desc]) => (
          <div className="stat-row" key={status}><span style={{ fontWeight: 700 }}>{status.replace(/_/g, ' ')}</span><span style={{ color: 'var(--text-soft)', textAlign: 'right', maxWidth: '65%' }}>{desc}</span></div>
        ))}
      </div>

      <div className="card">
        <div className="section-title"><i className="fas fa-bolt" />Freshness</div>
        {FRESHNESS_LEVELS.map(([level, desc]) => (
          <div className="stat-row" key={level}><span style={{ fontWeight: 700 }}>{level}</span><span style={{ color: 'var(--text-soft)', textAlign: 'right', maxWidth: '65%' }}>{desc}</span></div>
        ))}
      </div>

      <div className="card">
        <div className="section-title"><i className="fas fa-calculator" />Scoring Formulas</div>
        <div style={{ display: 'grid', gap: 10, fontSize: 12.5, fontFamily: 'monospace', background: 'var(--surface-alt)', padding: 14, borderRadius: 10, lineHeight: 1.8 }}>
          <div>FMS Overall = 50% Timeliness + 25% Pending Health + 15% Data Quality + 10% Freshness</div>
          <div>Doer Score = 60% Timeliness + 25% Pending Health + 15% Freshness</div>
          <div>Bottleneck Score = (Overdue × 4) + (Stalled × 4) + (Late × 2) + Delay-Days + (Critical Stale × 3) + (Data Exceptions × 2)</div>
          <div>Timeliness = On-Time Completed / Total Completed</div>
          <div>Pending Health = Pending Not-Overdue / Total Pending</div>
        </div>
      </div>

      {permissions.length > 0 && (
        <div className="card">
          <div className="section-title"><i className="fas fa-shield-halved" />Role × Permission Matrix</div>
          <div className="table-scroll">
            <table className="perm-matrix">
              <thead>
                <tr><th>Permission</th>{roles.map((r) => <th key={r.roleId}>{r.roleName}</th>)}</tr>
              </thead>
              <tbody>
                {permissions.map((perm) => (
                  <tr key={perm}>
                    <td>{perm}</td>
                    {roles.map((r) => (
                      <td key={r.roleId}>{r.permissions[perm] ? <i className="fas fa-check" style={{ color: 'var(--green)' }} /> : <i className="fas fa-minus" style={{ color: 'var(--grey)' }} />}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <div className="section-title"><i className="fas fa-lock" />Data Privacy</div>
        <p style={{ fontSize: 13, color: 'var(--text-soft)', lineHeight: 1.6 }}>
          Every connected FMS's underlying spreadsheet stays exactly where it is — this dashboard only reads the small,
          already-computed status summary each FMS publishes on its own, and never modifies any source spreadsheet.
        </p>
      </div>
    </div>
  );
}
