import { NAV_GROUPS } from '../nav';
import { useAuth } from '../context/AuthContext';

interface SidebarProps {
  route: string;
  onNavigate: (route: string) => void;
  mobileOpen: boolean;
}

// Direct port of app/index.html's Sidebar component/CSS — same off-canvas mobile pattern
// (translateX drawer + backdrop, see styles.css), same visual language.
export function Sidebar({ route, onNavigate, mobileOpen }: SidebarProps) {
  const { user } = useAuth();
  const hasPerm = (perm: string) => user?.permissions?.[perm] === true;

  return (
    <div className={'sidebar' + (mobileOpen ? ' mobile-open' : '')}>
      <div className="sidebar-head">
        <div className="icon"><i className="fas fa-diagram-project" /></div>
        <div className="brand">Central FMS Dashboard<small>Le Fabco Pvt. Ltd.</small></div>
      </div>
      <div className="sidebar-scroll">
        {NAV_GROUPS.map((group) => {
          const visibleItems = group.items.filter((it) => hasPerm(it.perm));
          if (!visibleItems.length) return null;
          return (
            <div className="side-group" key={group.label}>
              <div className="side-group-label">{group.label}</div>
              {visibleItems.map((it) => (
                <div
                  key={it.key}
                  className={'side-item' + (route === it.key ? ' active' : '')}
                  onClick={() => onNavigate(it.key)}
                >
                  <i className={'fas ' + it.icon} />{it.label}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
