export function ProgressBar({ percent }: { percent: number | null | undefined }) {
  const p = Math.max(0, Math.min(100, percent || 0));
  return (
    <div>
      <div className="progress-track"><div className="progress-fill" style={{ width: p + '%' }} /></div>
      <div style={{ fontSize: 11, color: 'var(--text-soft)', marginTop: 3 }}>{p}%</div>
    </div>
  );
}
