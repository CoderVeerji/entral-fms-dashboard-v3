import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';

export type RouteParams = Record<string, string>;

interface NavigationState {
  route: string;
  params: RouteParams;
  navigate: (route: string, params?: RouteParams) => void;
}

const NavigationContext = createContext<NavigationState | null>(null);

export function useNavigation(): NavigationState {
  const ctx = useContext(NavigationContext);
  if (!ctx) throw new Error('useNavigation must be used within NavigationProvider');
  return ctx;
}

function readFromHash(): { route: string; params: RouteParams } {
  const hash = window.location.hash.replace('#', '');
  const [route, query] = hash.split('?');
  const params: RouteParams = {};
  if (query) new URLSearchParams(query).forEach((v, k) => { params[k] = v; });
  return { route: route || 'dashboard', params };
}

// Lightweight replacement for app/index.html's window.__navigate global — lets a click deep in
// one page (a KPI card, an FMS health card) jump to another page WITH a filter already applied
// (e.g. Dashboard's "Overdue" KPI -> Live Records pre-filtered to status=OVERDUE), the same jump
// the v1 app supported that v3 was missing entirely.
export function NavigationProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(readFromHash());

  useEffect(() => {
    const onHashChange = () => setState(readFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = useCallback((route: string, params?: RouteParams) => {
    const next = params && Object.keys(params).length ? `${route}?${new URLSearchParams(params).toString()}` : route;
    window.location.hash = next;
    setState({ route, params: params || {} });
  }, []);

  return (
    <NavigationContext.Provider value={{ route: state.route, params: state.params, navigate }}>
      {children}
    </NavigationContext.Provider>
  );
}
