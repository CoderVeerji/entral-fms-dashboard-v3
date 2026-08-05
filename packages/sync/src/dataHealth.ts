// Ported from app/Code.gs's runDataIntegrityChecks_ — same categories of real-world data bugs
// the user has hit before ("ek baar RUNNING ON TIME sab dikha raha tha", "plan time mein dikkat
// thi"): duplicate record IDs, and stage dates so far outside a sane range that the real cause is
// almost always a Step_Directory "Plan Col Name"/"Actual Col Name" pointing at the wrong column
// (e.g. a quantity column, whose numbers coerce into a bogus date near the Sheets epoch).
import { and, eq, gte, lte, or, sql } from 'drizzle-orm';
import { stageEvents, records } from '@fms/db';
import type { NormalizedRecord, NormalizedStageEvent } from './transform';
import type { createSyncDb } from './db';

export interface NormalizedRow {
  record: NormalizedRecord;
  stageEvents: NormalizedStageEvent[];
}

type Db = ReturnType<typeof createSyncDb>['db'];

export interface DataHealthIssue {
  fmsId: string;
  fmsName: string;
  type: string;
  detail: string;
}

// Status_Cache rows should already be deduped by record_id at the source
// (FMS_Status_Publisher.gs's own upsertStatusCache_ does this) — this is a defensive second
// check, and also the thing that actually prevents a crash: Postgres's `INSERT ... ON CONFLICT
// DO UPDATE` errors outright ("cannot affect row a second time") if the same (fms_id, record_id)
// appears twice in one INSERT batch, so this MUST run before upsertRecords, not just for
// reporting.
export function dedupeAndFindDuplicates(rowsIn: NormalizedRow[]): { deduped: NormalizedRow[]; duplicateIds: string[] } {
  const seen = new Map<string, NormalizedRow>();
  const duplicateIds = new Set<string>();
  for (const row of rowsIn) {
    const id = row.record.recordId;
    if (seen.has(id)) duplicateIds.add(id);
    seen.set(id, row); // last occurrence wins, matching FMS_Status_Publisher.gs's own convention
  }
  return { deduped: Array.from(seen.values()), duplicateIds: Array.from(duplicateIds) };
}

function sampleList(ids: string[]): string {
  return ids.slice(0, 8).join(', ') + (ids.length > 8 ? ` (+${ids.length - 8} more)` : '');
}

// A stage's Plan/Actual date should never legitimately fall this far outside "now" — computed
// relative to now so it needs no future upkeep, same window as the old app used.
const SANE_DATE_MIN_MS = () => Date.now() - 3 * 365 * 24 * 3600 * 1000;
const SANE_DATE_MAX_MS = () => Date.now() + 2 * 365 * 24 * 3600 * 1000;

export async function checkSuspiciousDates(db: Db, fmsId: string, fmsName: string): Promise<DataHealthIssue[]> {
  const badRows = await db.select({
    stageName: stageEvents.stageName, planTime: stageEvents.planTime, actualTime: stageEvents.actualTime,
    recordId: stageEvents.recordId,
  }).from(stageEvents).where(and(
    eq(stageEvents.fmsId, fmsId),
    or(
      and(sql`${stageEvents.planTime} IS NOT NULL`, or(lte(stageEvents.planTime, new Date(SANE_DATE_MIN_MS())), gte(stageEvents.planTime, new Date(SANE_DATE_MAX_MS())))),
      and(sql`${stageEvents.actualTime} IS NOT NULL`, or(lte(stageEvents.actualTime, new Date(SANE_DATE_MIN_MS())), gte(stageEvents.actualTime, new Date(SANE_DATE_MAX_MS())))),
    ),
  ));

  const byStageField = new Map<string, { stageName: string; field: string; recordIds: string[] }>();
  for (const row of badRows) {
    const min = SANE_DATE_MIN_MS(); const max = SANE_DATE_MAX_MS();
    const planBad = row.planTime && (row.planTime.getTime() <= min || row.planTime.getTime() >= max);
    const actualBad = row.actualTime && (row.actualTime.getTime() <= min || row.actualTime.getTime() >= max);
    for (const [field, bad] of [['plan', planBad], ['actual', actualBad]] as const) {
      if (!bad) continue;
      const key = `${row.stageName}|${field}`;
      if (!byStageField.has(key)) byStageField.set(key, { stageName: row.stageName, field, recordIds: [] });
      byStageField.get(key)!.recordIds.push(row.recordId);
    }
  }

  const issues: DataHealthIssue[] = [];
  for (const info of byStageField.values()) {
    if (info.recordIds.length < 2) continue; // a single odd date could be a genuine source typo, not a mapping error
    const colHint = info.field === 'plan' ? 'Plan Col Name' : 'Actual Col Name';
    issues.push({
      fmsId, fmsName, type: 'SUSPICIOUS_DATE_MAPPING',
      detail: `Stage "${info.stageName}" has ${info.recordIds.length} record(s) with a ${info.field} date far outside a sane range `
        + `(near year 1900, or years in the future) — usually means Step_Directory's "${colHint}" for this stage points at the wrong column. `
        + `Sample record(s): ${sampleList(info.recordIds)}`,
    });
  }
  return issues;
}

export async function checkNegativeDelay(db: Db, fmsId: string, fmsName: string): Promise<DataHealthIssue[]> {
  const rows = await db.select({ recordId: records.recordId, delay: records.delay })
    .from(records).where(and(eq(records.fmsId, fmsId), eq(records.isArchived, false)));

  const issues: DataHealthIssue[] = [];
  for (const row of rows) {
    const delay = row.delay as { minutes?: number } | null;
    if (delay && typeof delay.minutes === 'number' && delay.minutes < 0) {
      issues.push({
        fmsId, fmsName, type: 'NEGATIVE_DELAY',
        detail: `Record ${row.recordId} has a negative delay (${delay.minutes} min) — usually a Plan/Actual date typo at the source.`,
      });
    }
  }
  return issues;
}
