import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { PAGE_TITLES } from '../nav';
import { applyTheme, getStoredTheme } from '../theme';

interface TopbarProps {
  route: string;
  onToggleSidebar: () => void;
}

export function Topbar({ route, onToggleSidebar }: TopbarProps) {
  const { user, logout } = useAuth();
  const [isDark, setIsDark] = useState(getStoredTheme() === 'dark');
  const [menuOpen, setMenuOpen] = useState(false);
  const title = PAGE_TITLES[route] || ['Central FMS Dashboard', ''];

  function toggleTheme() {
    const next = isDark ? 'light' : 'dark';
    applyTheme(next);
    setIsDark(!isDark);
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
