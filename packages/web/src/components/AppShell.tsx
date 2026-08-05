import { useState, type ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

interface AppShellProps {
  route: string;
  onNavigate: (route: string) => void;
  children: ReactNode;
}

export function AppShell({ route, onNavigate, children }: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  function navigate(next: string) {
    onNavigate(next);
    setMobileOpen(false);
  }

  return (
    <div className="app-shell">
      <Sidebar route={route} onNavigate={navigate} mobileOpen={mobileOpen} />
      {mobileOpen && <div className="mobile-backdrop" onClick={() => setMobileOpen(false)} />}
      <div className="main-col">
        <Topbar route={route} onToggleSidebar={() => setMobileOpen((o) => !o)} />
        <div className="page-body">{children}</div>
      </div>
    </div>
  );
}
