import { useState, type ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { useHelp } from '../context/HelpContext';

interface AppShellProps {
  route: string;
  onNavigate: (route: string) => void;
  children: ReactNode;
}

export function AppShell({ route, onNavigate, children }: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { enabled: helpEnabled, lang } = useHelp();

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
        <div className="page-body">
          {helpEnabled && (
            <div className="help-mode-banner">
              <i className="fas fa-circle-question" />
              {lang === 'hi' ? 'Help mode ON — jo bhi pulsing ? badge dikhe, uspe click karke samjho.' : 'Help mode is ON — click any pulsing ? badge to learn what it means.'}
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
