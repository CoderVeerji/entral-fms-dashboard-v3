// Neon's free-tier compute auto-suspends after a few minutes idle; the first query after that can
// take several seconds to wake it and occasionally fails outright rather than just being slow (see
// plan §"Known risks with the free/no-card constraint"). Wrapping only the first read query of a
// request (session lookup / login user lookup) in one retry absorbs that wake-up hiccup without
// risking a double-write anywhere — every call site here is a plain SELECT.
export async function withDbRetry<T>(label: string, fn: () => Promise<T>, retries = 2, delayMs = 300): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries) break;
      console.error(`[db-retry] ${label} failed (attempt ${attempt + 1}/${retries + 1}), retrying:`, err);
      await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
    }
  }
  throw lastErr;
}
