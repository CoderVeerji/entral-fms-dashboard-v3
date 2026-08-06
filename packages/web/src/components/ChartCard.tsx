import { useEffect, useRef } from 'react';
import { Chart, type ChartType } from 'chart.js/auto';

interface ChartCardProps {
  title: string;
  type: ChartType;
  labels: string[];
  datasets: { label?: string; data: number[]; backgroundColor?: string | string[]; borderColor?: string }[];
  height?: number;
}

const PALETTE = ['#1677FF', '#17C3B2', '#F5A623', '#E5484D', '#7C4DFF', '#12B76A', '#0B53C4', '#0A7A49'];

// Port of app/index.html's ChartCard — auto-palettes bars/lines per-dataset vs. doughnut/pie
// per-slice, destroys/rebuilds the Chart.js instance on data change to avoid leaking canvases.
export function ChartCard({ title, type, labels, datasets, height = 260 }: ChartCardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    if (chartRef.current) chartRef.current.destroy();
    const isSliceChart = type === 'doughnut' || type === 'pie';

    const ds = datasets.map((d, i) => ({
      ...d,
      backgroundColor: d.backgroundColor ?? (isSliceChart
        ? labels.map((_, li) => PALETTE[li % PALETTE.length])
        : (type === 'line' ? 'rgba(22,119,255,.12)' : PALETTE[i % PALETTE.length])),
      borderColor: d.borderColor ?? (isSliceChart ? '#ffffff' : PALETTE[i % PALETTE.length]),
      borderWidth: 2,
      tension: 0.35,
      borderRadius: type === 'bar' ? 6 : 0,
    }));

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    chartRef.current = new Chart(ctx, {
      type, data: { labels, datasets: ds },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: isSliceChart || datasets.length > 1, position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } },
        scales: isSliceChart ? {} : { y: { beginAtZero: true, grid: { color: '#F0F3F8' } }, x: { grid: { display: false } } },
      },
    });
    return () => { chartRef.current?.destroy(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(labels), JSON.stringify(datasets), type]);

  return (
    <div className="card">
      <div className="section-title"><i className="fas fa-chart-column" />{title}</div>
      <div style={{ height }}><canvas ref={canvasRef} /></div>
    </div>
  );
}
