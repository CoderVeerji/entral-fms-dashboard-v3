// Port of app/index.html's KpiCard.
const COLOR_MAP: Record<string, { bg: string; fg: string }> = {
  blue: { bg: '#E8F1FF', fg: 'var(--blue)' },
  green: { bg: 'var(--green-bg)', fg: 'var(--green)' },
  red: { bg: 'var(--red-bg)', fg: 'var(--red)' },
  amber: { bg: 'var(--amber-bg)', fg: 'var(--amber)' },
  grey: { bg: 'var(--grey-bg)', fg: 'var(--grey)' },
};

interface KpiCardProps {
  icon: string;
  color: 'blue' | 'green' | 'red' | 'amber' | 'grey';
  value: number | string;
  label: string;
}

export function KpiCard({ icon, color, value, label }: KpiCardProps) {
  const { bg, fg } = COLOR_MAP[color] || COLOR_MAP.blue;
  return (
    <div className="card kpi-card">
      <div className="kpi-icon" style={{ background: bg, color: fg }}><i className={'fas ' + icon} /></div>
      <div>
        <div className="kpi-value">{value}</div>
        <div className="kpi-label">{label}</div>
      </div>
    </div>
  );
}
