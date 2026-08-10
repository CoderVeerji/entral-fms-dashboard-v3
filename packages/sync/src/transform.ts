// Pure, dependency-injected Sheets-row -> Postgres-row transform (no network calls) — see plan
// §"Test strategy". Input shape matches FMS_Status_Publisher.gs's STATUS_CACHE_HEADERS exactly
// (app/FMS_Status_Publisher.gs):
//   record_id, raw_row, display_name, current_stage, doer, doer_email, plan_time_iso,
//   record_status, delay_json, completed_steps, total_steps, last_update_iso, freshness,
//   sequence_exception, stage_results_json, is_closed, updated_at, details_json

export interface StatusCacheRow {
  record_id: string;
  raw_row: number | string;
  display_name: string;
  current_stage: string;
  doer: string;
  doer_email: string;
  plan_time_iso: string;
  record_status: string;
  delay_json: string;
  completed_steps: number | string;
  total_steps: number | string;
  last_update_iso: string;
  freshness: string;
  sequence_exception: boolean | string;
  stage_results_json: string;
  is_closed: boolean | string;
  updated_at: string;
  // Optional — absent entirely for an FMS still running an older publisher script (see
  // app/FMS_Status_Publisher.gs's header comment); transformStatusCacheRow treats that the same
  // as an empty object, never an error.
  details_json?: string;
}

interface RawStageResult {
  stage_index: number;
  stage_name: string;
  doer_name?: string;
  doer_email?: string;
  status: string;
  plan?: string | null;
  actual?: string | null;
  variance_minutes?: number | null;
}

export interface NormalizedRecord {
  fmsId: string;
  recordId: string;
  rawRow: number | null;
  displayName: string;
  currentStage: string;
  doer: string;
  doerEmail: string;
  planTime: Date | null;
  recordStatus: string;
  delay: unknown;
  completedSteps: number;
  totalSteps: number;
  lastUpdate: Date | null;
  freshness: string;
  sequenceException: boolean;
  isClosed: boolean;
  isArchived: boolean;
  details: Record<string, unknown> | null;
}

export interface NormalizedStageEvent {
  fmsId: string;
  recordId: string;
  stageIndex: number;
  stageName: string;
  doerName: string | null;
  doerEmail: string | null;
  status: string;
  planTime: Date | null;
  actualTime: Date | null;
  varianceMinutes: number | null;
}

function parseIsoOrNull(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseJsonOrNull<T>(v: string | null | undefined): T | null {
  if (!v) return null;
  try { return JSON.parse(v) as T; } catch { return null; }
}

function toBool(v: boolean | string | undefined): boolean {
  return v === true || v === 'true' || v === 'TRUE';
}

export function transformStatusCacheRow(fmsId: string, row: StatusCacheRow): {
  record: NormalizedRecord;
  stageEvents: NormalizedStageEvent[];
} {
  const record: NormalizedRecord = {
    fmsId,
    recordId: String(row.record_id),
    rawRow: row.raw_row === '' || row.raw_row === undefined ? null : Number(row.raw_row),
    displayName: row.display_name ?? '',
    currentStage: row.current_stage ?? '',
    doer: row.doer ?? '',
    doerEmail: row.doer_email ?? '',
    planTime: parseIsoOrNull(row.plan_time_iso),
    recordStatus: row.record_status,
    delay: parseJsonOrNull(row.delay_json),
    completedSteps: Number(row.completed_steps) || 0,
    totalSteps: Number(row.total_steps) || 0,
    lastUpdate: parseIsoOrNull(row.last_update_iso),
    freshness: row.freshness ?? 'Never',
    sequenceException: toBool(row.sequence_exception),
    isClosed: toBool(row.is_closed),
    isArchived: false,
    details: parseJsonOrNull<Record<string, unknown>>(row.details_json),
  };

  const rawStages = parseJsonOrNull<RawStageResult[]>(row.stage_results_json) ?? [];
  const stageEvents: NormalizedStageEvent[] = rawStages.map((sr, idx) => ({
    fmsId,
    recordId: record.recordId,
    stageIndex: sr.stage_index ?? idx,
    stageName: sr.stage_name,
    doerName: sr.doer_name || null,
    doerEmail: sr.doer_email || null,
    status: sr.status,
    planTime: parseIsoOrNull(sr.plan),
    actualTime: parseIsoOrNull(sr.actual),
    varianceMinutes: sr.variance_minutes ?? null,
  }));

  return { record, stageEvents };
}

// Given the FULL set of record_ids currently upserted for an FMS and the set of record_ids just
// read from that FMS's Status_Cache this run, returns which previously-known record_ids are now
// missing — these get is_archived = true (mirrors app/Code.gs's markArchivedFmsRecords_ /
// FMS_Records_Summary.is_archived behavior). Pure set-difference, no I/O.
export function findArchivedRecordIds(previouslyKnownIds: string[], currentlyPresentIds: string[]): string[] {
  const presentSet = new Set(currentlyPresentIds);
  return previouslyKnownIds.filter((id) => !presentSet.has(id));
}

// Every field a fresh Status_Cache read can actually change, i.e. everything upsertRecords writes
// except recordId/fmsId (the lookup key) and synchronization bookkeeping (syncedAt). isArchived is
// included deliberately: it lets a record that reappears after being archived be detected as
// "changed" purely from this comparison (its stored isArchived=true vs the freshly-read false),
// without any special-case archival-reversal logic.
export type RecordSnapshot = Pick<NormalizedRecord,
  | 'rawRow' | 'displayName' | 'currentStage' | 'doer' | 'doerEmail' | 'planTime' | 'recordStatus'
  | 'delay' | 'completedSteps' | 'totalSteps' | 'lastUpdate' | 'freshness' | 'sequenceException'
  | 'isClosed' | 'isArchived' | 'details'>;

function snapshotsEqual(a: RecordSnapshot, b: RecordSnapshot): boolean {
  return a.rawRow === b.rawRow && a.displayName === b.displayName && a.currentStage === b.currentStage
    && a.doer === b.doer && a.doerEmail === b.doerEmail
    && (a.planTime?.getTime() ?? null) === (b.planTime?.getTime() ?? null)
    && a.recordStatus === b.recordStatus && a.completedSteps === b.completedSteps && a.totalSteps === b.totalSteps
    && (a.lastUpdate?.getTime() ?? null) === (b.lastUpdate?.getTime() ?? null)
    && a.freshness === b.freshness && a.sequenceException === b.sequenceException
    && a.isClosed === b.isClosed && a.isArchived === b.isArchived
    // delay/details are small JSON blobs (a handful of fields / free-text business columns) —
    // stringify comparison is simple, correct, and cheap at this size; not worth a deep-equal dep.
    && JSON.stringify(a.delay ?? null) === JSON.stringify(b.delay ?? null)
    && JSON.stringify(a.details ?? {}) === JSON.stringify(b.details ?? {});
}

// The core of the "only touch what actually changed" sync (see plan §"Sync job" — this is what
// makes a 5-minute cadence affordable on Neon's free egress allowance instead of rewriting every
// record + re-deriving every stage_event on every single run regardless of whether anything in
// this FMS moved). A record status/freshness/delay CAN legitimately change purely from time passing
// (e.g. AT_RISK -> OVERDUE) even when lastUpdate does not — so this compares every written field,
// not just lastUpdate, to stay correct for that case while still skipping the common case where
// nothing changed at all.
export function diffChangedRecords(existingByRecordId: Map<string, RecordSnapshot>, incoming: NormalizedRecord[]): NormalizedRecord[] {
  return incoming.filter((rec) => {
    const prev = existingByRecordId.get(rec.recordId);
    return !prev || !snapshotsEqual(prev, rec);
  });
}
