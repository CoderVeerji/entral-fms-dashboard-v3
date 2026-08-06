// Local-only theme/accent toggle (localStorage, applied as data-theme/data-accent on <html>) —
// app/Code.gs persisted this server-side via saveUserPreferences; that endpoint doesn't exist in
// v3 yet, so this is deliberately simpler until it's shown to matter (REBUILD_PLAN principle: don't
// build ahead of need).
const THEME_KEY = 'fms_theme';
const ACCENT_KEY = 'fms_accent';

export type Accent = 'ocean' | 'emerald' | 'purple' | 'sunset' | 'crimson';
export const ACCENT_PRESETS: { id: Accent; label: string; swatch: string }[] = [
  { id: 'ocean', label: 'Ocean', swatch: 'linear-gradient(135deg,#1677FF,#17C3B2)' },
  { id: 'emerald', label: 'Emerald', swatch: 'linear-gradient(135deg,#10B981,#34D399)' },
  { id: 'purple', label: 'Purple', swatch: 'linear-gradient(135deg,#7C4DFF,#B794F6)' },
  { id: 'sunset', label: 'Sunset', swatch: 'linear-gradient(135deg,#F5822A,#FFC24B)' },
  { id: 'crimson', label: 'Crimson', swatch: 'linear-gradient(135deg,#E5484D,#FF8A80)' },
];

export function getStoredTheme(): 'light' | 'dark' {
  return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
}

export function applyTheme(theme: 'light' | 'dark'): void {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
}

export function getStoredAccent(): Accent {
  const v = localStorage.getItem(ACCENT_KEY);
  return (ACCENT_PRESETS.some((a) => a.id === v) ? v : 'ocean') as Accent;
}

export function applyAccent(accent: Accent): void {
  if (accent === 'ocean') document.documentElement.removeAttribute('data-accent');
  else document.documentElement.setAttribute('data-accent', accent);
  localStorage.setItem(ACCENT_KEY, accent);
}
