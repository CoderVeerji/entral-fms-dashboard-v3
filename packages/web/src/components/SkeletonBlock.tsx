export function SkeletonBlock({ rows = 4 }: { rows?: number }) {
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height: 16, width: i % 3 === 0 ? '60%' : '100%' }} />
      ))}
    </div>
  );
}
