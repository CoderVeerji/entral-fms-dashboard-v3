// Tiny external store (no extra dependency) tracking in-flight API calls app-wide, subscribed via
// React 18's useSyncExternalStore in <LoadingBar>. Port of app/index.html's pendingCalls counter
// that drove its top-of-viewport loading bar — ambient feedback for every in-flight call, not
// just the ones a specific page bothered to show a spinner for.
let pending = 0;
const listeners = new Set<() => void>();

export function notifyCallStart(): void {
  pending++;
  listeners.forEach((l) => l());
}

export function notifyCallEnd(): void {
  pending = Math.max(0, pending - 1);
  listeners.forEach((l) => l());
}

export function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function getPendingCount(): number {
  return pending;
}
