import { defineConfig } from 'vitest/config';

// DB-integration tests occasionally hit Neon's free-tier compute cold-start latency (same
// "terminating connection due to administrator command" / slow-first-query pattern documented in
// packages/sync/src/db.ts's warmUpConnection) — a longer hook/test timeout absorbs that instead
// of failing a otherwise-correct test on a slow morning.
export default defineConfig({
  test: {
    hookTimeout: 20000,
    testTimeout: 15000,
  },
});
