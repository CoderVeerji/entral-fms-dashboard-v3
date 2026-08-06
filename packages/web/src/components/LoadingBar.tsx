import { useSyncExternalStore } from 'react';
import { subscribe, getPendingCount } from '../loadingStore';

// Top-of-viewport ambient progress bar tied to every in-flight API call app-wide — port of
// app/index.html's loading-bar/pendingCalls pattern. Mounted once at the app root.
export function LoadingBar() {
  const pending = useSyncExternalStore(subscribe, getPendingCount);
  if (pending === 0) return null;
  return <div className="loading-bar" />;
}
