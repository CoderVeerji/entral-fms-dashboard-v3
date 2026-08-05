// Local-only theme toggle for now (localStorage, applied as data-theme on <html>) — app/Code.gs
// persisted this server-side via saveUserPreferences; that endpoint doesn't exist in v3 yet, so
// this is deliberately simpler until Settings/My Account land (REBUILD_PLAN principle: don't
// build ahead of need).
const THEME_KEY = 'fms_theme';

export function getStoredTheme(): 'light' | 'dark' {
  return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
}

export function applyTheme(theme: 'light' | 'dark'): void {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
}
