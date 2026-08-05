import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import * as api from '../api';
import { PAGE_TITLES } from '../nav';
import { applyTheme, getStoredTheme } from '../theme';

interface TopbarProps {
  route: string;
  onToggleSidebar: () => void;
}

export function Topbar({ route, onToggleSidebar }: TopbarProps) {
  const { user, token, logout } = useAuth();
  const [isDark, setIsDark] = useState(getStoredTheme() === 'dark');
  const [menuOpen, setMenuOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const title = PAGE_TITLES[route] || ['Central FMS Dashboard', ''];

  function toggleTheme() {
    const next = isDark ? 'light' : 'dark';
    applyTheme(next);
    setIsDark(!isDark);
  }

  async function syncNow() {
    if (!token || syncing) return;
    setSyncing(true);
    setSyncMessage(null);
    const res = await api.triggerSync(token);
    setSyncing(false);
    setSyncMessage(res.ok ? res.message : res.message);
    setTimeout(() => setSyncMessage(null), 6000);
  }

  return (
    <div className="topbar">
      <div className="topbar-left">
        <button className="icon-btn hamburger-btn" onClick={onToggleSidebar}><i className="fas fa-bars" /></button>
        <div>
          <div className="page-title">{title[0]}</div>
          <div className="page-sub">{title[1]}</div>
        </div>
      </div>
      <div className="topbar-right">
        {syncMessage && <span className="sync-toast">{syncMessage}</span>}
        <button className="icon-btn" onClick={syncNow} disabled={syncing} title="Sync Now — pull fresh data from every connected FMS">
          <i className={'fas fa-arrows-rotate' + (syncing ? ' fa-spin' : '')} />
        </button>
        <button className="icon-btn" onClick={toggleTheme} title={isDark ? 'Switch to Light theme' : 'Switch to Dark theme'}>
          <i className={'fas ' + (isDark ? 'fa-sun' : 'fa-moon')} />
        </button>
        <div className="user-chip" onClick={() => setMenuOpen((o) => !o)}>
          <div className="avatar">{(user?.fullName || user?.username || 'U').substring(0, 1).toUpperCase()}</div>
          <div>
            <div className="name">{user?.fullName || user?.username}</div>
            <div className="role">{user?.roleName}</div>
          </div>
          {menuOpen && <button onClick={(e) => { e.stopPropagation(); logout(); }}>Sign out</button>}
        </div>
      </div>
    </div>
  );
}
