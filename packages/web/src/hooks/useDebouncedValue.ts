import { useState, useEffect } from 'react';

// Port of app/index.html's useDebouncedValue — the input stays instant on screen, but the value
// consumed by the API call only updates 400ms after typing stops, so Live Records/Action Center
// search doesn't fire a network request on every keystroke.
export function useDebouncedValue<T>(value: T, delayMs = 400): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}
