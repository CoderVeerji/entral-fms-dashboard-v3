// Integration tests against a REAL Postgres — same convention as bottlenecks.test.ts. Exercises
// runAiTool directly (not through Gemini/HTTP) since these are the only parts of the AI feature
// with real query-correctness risk; the Gemini REST client itself is a thin, manually-verified
// wrapper (see gemini.ts's header comment) that would need a real network call + real quota to
// test here, which CI shouldn't spend on every run.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import * as schema from '@fms/db';
import { createDb } from '../db';
import { runAiTool } from './tools';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('AI tools (integration)', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const apiDb = DATABASE_URL ? createDb(DATABASE_URL) : null;
  const fmsA = 'fms_ai_tools_test_a';
  // data_health_cache is a single GLOBAL row (id=1), shared with the real running app — unlike
  // every other table this suite touches, there's no test-scoped fmsId to isolate it by. Back up
  // whatever's really there before overwriting it, and restore it exactly in afterAll's finally.
  // (Real incident during implementation: an earlier version of this test overwrote it and never
  // restored it, so a real user saw this suite's fake "test issue" on the live Data Health page
  // and through the AI Assistant until the next real sync ran.)
  let originalDataHealth: typeof schema.dataHealthCache.$inferSelect | undefined;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    db = drizzle(pool, { schema });

    await db.insert(schema.fmsMaster).values({
      fmsId: fmsA, fmsName: 'AI Tools Test FMS', spreadsheetId: 'sheet_ai_tools', active: true,
      lastSyncStatus: 'SUCCESS', lastSuccessfulSync: new Date(),
    }).onConflictDoNothing();

    await db.insert(schema.fmsEvalCache).values({
      fmsId: fmsA, computedAt: new Date(),
      totals: { total: 12, overdue: 3, stalled: 1, atRisk: 2 },
      scores: { overall: 62.5 },
      stageBottlenecks: [{ key: 'Invoicing', doerName: '', doerEmail: '', assigned: 5, completed: 2, onTime: 1, late: 1, pending: 3, overdue: 2, stalled: 0, avgDelayMinutes: 60, avgDelayHuman: '1h', maxDelayMinutes: 60, maxDelayHuman: '1h', onTimePercent: 50, dataExceptions: 0, criticalStale: 0, totalDelayDays: 0.1, bottleneckScore: 10.1, reason: 'test' }],
      doerBottlenecks: [],
    }).onConflictDoNothing();

    await db.insert(schema.records).values([
      { fmsId: fmsA, recordId: 'r1', displayName: 'Overdue Order', doer: 'Priya', recordStatus: 'OVERDUE', freshness: 'Stale' },
      { fmsId: fmsA, recordId: 'r2', displayName: 'On Track Order', doer: 'Ravi', recordStatus: 'RUNNING_ON_TIME', freshness: 'Fresh' },
    ]);

    const [existing] = await db.select().from(schema.dataHealthCache).where(eq(schema.dataHealthCache.id, 1)).limit(1);
    originalDataHealth = existing;

    await db.insert(schema.dataHealthCache).values({
      id: 1, checkedAt: new Date(), issueCount: 1,
      issues: [{ fmsId: fmsA, fmsName: 'AI Tools Test FMS', type: 'NEGATIVE_DELAY', detail: 'test issue' }],
    }).onConflictDoUpdate({
      target: schema.dataHealthCache.id,
      set: { checkedAt: new Date(), issueCount: 1, issues: [{ fmsId: fmsA, fmsName: 'AI Tools Test FMS', type: 'NEGATIVE_DELAY', detail: 'test issue' }] },
    });
  });

  afterAll(async () => {
    try {
      await db.delete(schema.records).where(eq(schema.records.fmsId, fmsA));
      await db.delete(schema.fmsEvalCache).where(eq(schema.fmsEvalCache.fmsId, fmsA));
      await db.delete(schema.fmsMaster).where(eq(schema.fmsMaster.fmsId, fmsA));
    } finally {
      if (originalDataHealth) {
        await db.update(schema.dataHealthCache).set({
          checkedAt: originalDataHealth.checkedAt, issueCount: originalDataHealth.issueCount, issues: originalDataHealth.issues,
        }).where(eq(schema.dataHealthCache.id, 1));
      } else {
        await db.delete(schema.dataHealthCache).where(eq(schema.dataHealthCache.id, 1));
      }
      await pool.end();
    }
  });

  it('get_fms_overview reports this FMS\'s score and totals', async () => {
    const result = await runAiTool(apiDb!, 'get_fms_overview', {}) as { fmsId: string }[];
    const row = result.find((r) => r.fmsId === fmsA) as unknown as { overallScore: number; activeRecords: number; overdueRecords: number };
    expect(row).toBeTruthy();
    expect(row.overallScore).toBe(62.5);
    expect(row.activeRecords).toBe(12);
    expect(row.overdueRecords).toBe(3);
  });

  it('search_records filters by fmsId and status', async () => {
    const result = await runAiTool(apiDb!, 'search_records', { fmsId: fmsA, status: 'OVERDUE' }) as { recordId: string }[];
    expect(result).toHaveLength(1);
    expect(result[0].recordId).toBe('r1');
  });

  it('get_bottleneck_summary returns the seeded stage bucket, sorted by score', async () => {
    const result = await runAiTool(apiDb!, 'get_bottleneck_summary', { scope: 'stage', fmsId: fmsA }) as { key: string }[];
    expect(result[0].key).toBe('Invoicing');
  });

  it('get_data_health_issues returns the seeded issue', async () => {
    const result = await runAiTool(apiDb!, 'get_data_health_issues', {}) as { issueCount: number; issues: { fmsId: string }[] };
    expect(result.issueCount).toBe(1);
    expect(result.issues.some((i) => i.fmsId === fmsA)).toBe(true);
  });

  it('unknown tool name returns an error object instead of throwing', async () => {
    const result = await runAiTool(apiDb!, 'not_a_real_tool', {}) as { error: string };
    expect(result.error).toMatch(/Unknown tool/);
  });
});
