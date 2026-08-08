import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigation } from '../context/NavigationContext';
import * as api from '../api';
import { Modal } from './Modal';
import { SkeletonBlock } from './SkeletonBlock';

interface UpcomingCalendarModalProps {
  fmsIds: string[];
  doers: string[];
  onClose: () => void;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Plain hand-rolled month grid (no calendar library — same "stay self-contained" precedent
// MarkdownView.tsx already set) over data fetched once on open; Prev/Next just changes which
// month's cells are read from the already-fetched full dataset, not a new network call.
export function UpcomingCalendarModal({ fmsIds, doers, onClose }: UpcomingCalendarModalProps) {
  const { token } = useAuth();
  const { navigate } = useNavigation();
  const [countsByDate, setCountsByDate] = useState<Map<string, number> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewMonth, setViewMonth] = useState(() => { const d = new Date(); d.setDate(1); return d; });

  useEffect(() => {
    if (!token) return;
    setCountsByDate(null);
    api.getUpcomingCalendar(token, { fmsIds, doers }).then((res) => {
      if (!res.ok) { setError(res.message); return; }
      setError(null);
      setCountsByDate(new Map(res.data.map((d) => [d.date, d.count])));
    });
  }, [token, fmsIds, doers]);

  function goToDay(dateStr: string, count: number) {
    if (count === 0) return;
    onClose();
    navigate('liveRecords', {
      ...(fmsIds.length === 1 ? { fmsId: fmsIds[0] } : {}),
      ...(doers.length === 1 ? { doer: doers[0] } : {}),
      dateFrom: dateStr, dateTo: dateStr,
    });
  }

  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const firstDayOfWeek = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthLabel = viewMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const todayStr = toISODate(new Date());

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDayOfWeek; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const monthTotal = countsByDate
    ? [...countsByDate.entries()].filter(([date]) => date.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`)).reduce((sum, [, c]) => sum + c, 0)
    : 0;

  return (
    <Modal title="Upcoming — Calendar" onClose={onClose} large>
      {error && <div className="login-error">{error}</div>}
      {!countsByDate && !error && <SkeletonBlock rows={6} />}
      {countsByDate && (
        <div className="calendar">
          <div className="calendar-nav">
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setViewMonth(new Date(year, month - 1, 1))}>
              <i className="fas fa-chevron-left" />
            </button>
            <div className="calendar-month-label">{monthLabel}{monthTotal > 0 && <span className="calendar-month-total"> · {monthTotal} tasks</span>}</div>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setViewMonth(new Date(year, month + 1, 1))}>
              <i className="fas fa-chevron-right" />
            </button>
          </div>
          <div className="calendar-grid calendar-weekdays">
            {WEEKDAYS.map((w) => <div key={w} className="calendar-weekday">{w}</div>)}
          </div>
          <div className="calendar-grid">
            {cells.map((d, i) => {
              if (d === null) return <div key={i} className="calendar-cell calendar-cell-empty" />;
              const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
              const count = countsByDate.get(dateStr) ?? 0;
              return (
                <div key={i}
                  className={'calendar-cell' + (count > 0 ? ' calendar-cell-active' : '') + (dateStr === todayStr ? ' calendar-cell-today' : '')}
                  onClick={() => goToDay(dateStr, count)}>
                  <div className="calendar-day-num">{d}</div>
                  {count > 0 && <div className="calendar-day-count">{count}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Modal>
  );
}
