import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigation } from '../context/NavigationContext';
import * as api from '../api';
import { PAGE_TITLES } from '../nav';
import { applyTheme, getStoredTheme } from '../theme';
import { ChangePasswordScreen } from '../pages/ChangePasswordScreen';
import { useHelp } from '../context/HelpContext';

interface TopbarProps {
  route: string;
  onToggleSidebar: () => void;
}

export function Topbar({ route, onToggleSidebar }: TopbarProps) {
  const { user, token, logout } = useAuth();
  const { navigate } = useNavigation();
  const { enabled: helpEnabled, toggle: toggleHelp } = useHelp();
  const [isDark, setIsDark] = useState(getStoredTheme() === 'dark');
  const [menuOpen, setMenuOpen] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
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
    setSyncMessage(res.message);
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
      <div className="topbar-right" style={{ position: 'relative' }}>
        {syncMessage && <span className="sync-toast">{syncMessage}</span>}
        <button className="icon-btn" onClick={syncNow} disabled={syncing} title="Sync Now — pull fresh data from every connected FMS">
          <i className={'fas fa-arrows-rotate' + (syncing ? ' fa-spin' : '')} />
        </button>
        <button className="icon-btn" onClick={toggleTheme} title={isDark ? 'Switch to Light theme' : 'Switch to Dark theme'}>
          <i className={'fas ' + (isDark ? 'fa-sun' : 'fa-moon')} />
        </button>
        <button
          className={'icon-btn' + (helpEnabled ? ' icon-btn-active' : '')} onClick={toggleHelp}
          title={helpEnabled ? 'Turn off Help mode' : 'Turn on Help mode — click the ? badges that appear to learn what things mean'}
        >
          <i className="fas fa-circle-question" />
        </button>
        <div className="user-chip" onClick={() => setMenuOpen((o) => !o)}>
          <div className="avatar">{(user?.fullName || user?.username || 'U').substring(0, 1).toUpperCase()}</div>
          <div>
            <div className="name">{user?.fullName || user?.username}</div>
            <div className="role">{user?.roleName}</div>
          </div>
        </div>
        {menuOpen && (
          <div className="dropdown-menu" onMouseLeave={() => setMenuOpen(false)}>
            <div className="dm-item" onClick={() => { navigate('myAccount'); setMenuOpen(false); }}>
              <i className="fas fa-user" /> My Account
            </div>
            <div className="dm-item" onClick={() => { setShowChangePassword(true); setMenuOpen(false); }}>
              <i className="fas fa-key" /> Change Password
            </div>
            <div className="dm-item" onClick={() => logout()}>
              <i className="fas fa-right-from-bracket" /> Sign out
            </div>
          </div>
        )}
      </div>
      {showChangePassword && (
        <ChangePasswordScreen forced={false} onDone={() => setShowChangePassword(false)} onCancel={() => setShowChangePassword(false)} />
      )}
    </div>
  );
}
