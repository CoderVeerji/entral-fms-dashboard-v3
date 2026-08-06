import type { ReactNode } from 'react';

// Port of app/index.html's Drawer — a right-side slide-in panel, higher z-index than Modal so a
// drawer opened from a button inside an already-open modal (e.g. a bottleneck row's detail) still
// renders on top of it.
export function Drawer({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer">{children}</div>
    </>
  );
}
