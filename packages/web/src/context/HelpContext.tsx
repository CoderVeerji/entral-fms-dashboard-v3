import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

// Powers the "?" Help mode toggled from the Topbar — while on, HelpHotspot badges appear next to
// annotated elements across the app; clicking one shows its explanation in HelpPanel. Off by
// default and never persisted (it's an exploration mode you turn on, not a permanent setting);
// the chosen language DOES persist (localStorage), same pattern as theme/accent in theme.ts.
export type HelpLang = 'en' | 'hi';
export interface HelpExplanation { title: string; en: string; hi: string }

interface HelpApi {
  enabled: boolean;
  toggle: () => void;
  lang: HelpLang;
  setLang: (l: HelpLang) => void;
  active: HelpExplanation | null;
  // Bounding rect of the "?" badge that was clicked, captured at click time — lets HelpPanel open
  // anchored right next to it instead of always in a fixed screen corner.
  anchorRect: DOMRect | null;
  show: (exp: HelpExplanation, anchorRect: DOMRect) => void;
  hide: () => void;
}

const HelpContext = createContext<HelpApi | null>(null);

export function useHelp(): HelpApi {
  const ctx = useContext(HelpContext);
  if (!ctx) throw new Error('useHelp must be used within HelpProvider');
  return ctx;
}

const LANG_KEY = 'fms_help_lang';

export function HelpProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(false);
  const [lang, setLangState] = useState<HelpLang>(() => (localStorage.getItem(LANG_KEY) === 'hi' ? 'hi' : 'en'));
  const [active, setActive] = useState<HelpExplanation | null>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  const toggle = useCallback(() => {
    setEnabled((e) => !e);
    setActive(null);
    setAnchorRect(null);
  }, []);
  const setLang = useCallback((l: HelpLang) => {
    setLangState(l);
    localStorage.setItem(LANG_KEY, l);
  }, []);
  const show = useCallback((exp: HelpExplanation, rect: DOMRect) => { setActive(exp); setAnchorRect(rect); }, []);
  const hide = useCallback(() => { setActive(null); setAnchorRect(null); }, []);

  return (
    <HelpContext.Provider value={{ enabled, toggle, lang, setLang, active, anchorRect, show, hide }}>
      {children}
    </HelpContext.Provider>
  );
}
