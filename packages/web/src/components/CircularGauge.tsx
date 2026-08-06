// Port of app/index.html's CircularGauge — pure-SVG ring, animated stroke-dashoffset, auto
// color-thresholds. Renders "—" instead of a misleading 0% when there's no data to show.
interface CircularGaugeProps {
  value: number | null;
  label: string;
  size?: number;
}

function gaugeColor(value: number): string {
  if (value >= 90) return 'var(--green)';
  if (value >= 70) return 'var(--blue)';
  if (value >= 50) return 'var(--amber)';
  return 'var(--red)';
}

export function CircularGauge({ value, label, size = 84 }: CircularGaugeProps) {
  const radius = (size - 10) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div className="gauge-card">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--grey-bg)" strokeWidth={7} />
        {value != null && (
          <circle
            cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={gaugeColor(pct)} strokeWidth={7}
            strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ transition: 'stroke-dashoffset .5s ease' }}
          />
        )}
        <text x="50%" y="52%" textAnchor="middle" dominantBaseline="middle" fontSize={size * 0.22} fontWeight={800} fill="var(--navy)">
          {value != null ? `${Math.round(value)}%` : '—'}
        </text>
      </svg>
      <div className="gauge-label">{label}</div>
    </div>
  );
}
