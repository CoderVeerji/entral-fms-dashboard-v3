export interface LeaderboardEntry {
  key: string;
  name: string;
  score: number;
  subtitle?: string;
}

interface LeaderboardProps {
  rows: LeaderboardEntry[];
  currentUserKey?: string;
  scoreLabel?: string;
  scoreSuffix?: string;
}

function initials(name: string): string {
  return name.trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';
}

const PODIUM_COLORS = ['podium-gold', 'podium-silver', 'podium-bronze'];

function PodiumSlot({ entry, place, scoreSuffix }: { entry: LeaderboardEntry; place: 1 | 2 | 3; scoreSuffix: string }) {
  return (
    <div className={'podium-slot podium-slot-' + place}>
      {place === 1 && <i className="fas fa-crown podium-crown" />}
      <div className={'podium-avatar ' + PODIUM_COLORS[place - 1]}>{initials(entry.name)}</div>
      <div className="podium-name">{entry.name}</div>
      {entry.subtitle && <div style={{ fontSize: 10.5, color: 'var(--text-soft)', textAlign: 'center' }}>{entry.subtitle}</div>}
      <div className="podium-rank-badge">{place}</div>
      <div className="podium-score">{entry.score.toLocaleString()}{scoreSuffix}</div>
      <div className={'podium-block podium-block-' + place}>{place}</div>
    </div>
  );
}

// Top-3 podium + ranked list, with the current user's own rank pinned/highlighted at the bottom
// if they're outside the visible top rows — matches the reference leaderboard UI (crown on #1,
// colored podium blocks, "your rank" sticky highlight even when far down the list).
export function Leaderboard({ rows, currentUserKey, scoreLabel = 'Score', scoreSuffix = '' }: LeaderboardProps) {
  const top3 = rows.slice(0, 3);
  const rest = rows.slice(3, 10);
  const currentUserRow = currentUserKey ? rows.find((r) => r.key === currentUserKey) : undefined;
  const currentUserRank = currentUserRow ? rows.indexOf(currentUserRow) + 1 : null;
  const currentUserVisible = currentUserRank !== null && currentUserRank <= 10;

  return (
    <div className="leaderboard">
      {top3.length > 0 && (
        <div className="podium-row">
          {top3[1] && <PodiumSlot entry={top3[1]} place={2} scoreSuffix={scoreSuffix} />}
          {top3[0] && <PodiumSlot entry={top3[0]} place={1} scoreSuffix={scoreSuffix} />}
          {top3[2] && <PodiumSlot entry={top3[2]} place={3} scoreSuffix={scoreSuffix} />}
        </div>
      )}

      <div className="card leaderboard-list">
        <table className="records-table">
          <thead>
            <tr><th style={{ width: 60 }}>Rank</th><th>Name</th><th style={{ textAlign: 'right' }}>{scoreLabel}</th></tr>
          </thead>
          <tbody>
            {rest.map((r, i) => (
              <tr key={r.key} className={r.key === currentUserKey ? 'leaderboard-row-you' : ''}>
                <td>{i + 4}</td>
                <td style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div className="podium-avatar podium-avatar-sm">{initials(r.name)}</div>
                  <span>{r.name}{r.subtitle && <span style={{ color: 'var(--text-soft)', fontWeight: 400 }}> — {r.subtitle}</span>}</span>
                </td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{r.score.toLocaleString()}{scoreSuffix}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={3} className="empty-state">No data for this scope yet.</td></tr>
            )}
            {currentUserRow && !currentUserVisible && (
              <tr className="leaderboard-row-you">
                <td>{currentUserRank}</td>
                <td style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div className="podium-avatar podium-avatar-sm">{initials(currentUserRow.name)}</div>
                  {currentUserRow.name}
                </td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{currentUserRow.score.toLocaleString()}{scoreSuffix}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
