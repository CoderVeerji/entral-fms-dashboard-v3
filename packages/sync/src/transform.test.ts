import { describe, it, expect } from 'vitest';
import { transformStatusCacheRow, findArchivedRecordIds, type StatusCacheRow } from './transform';

function mkRow(overrides: Partial<StatusCacheRow> = {}): StatusCacheRow {
  return {
    record_id: 'REC-001', raw_row: 42, display_name: 'Acme Corp', current_stage: 'Invoicing',
    doer: 'Priya', doer_email: 'priya@example.com', plan_time_iso: '2026-08-05T10:00:00.000Z',
    record_status: 'OVERDUE', delay_json: '{"minutes":90,"hours":1.5,"days":0.1,"human":"1h 30m"}',
    completed_steps: 3, total_steps: 8, last_update_iso: '2026-08-04T09:00:00.000Z',
    freshness: 'Warning', sequence_exception: false,
    stage_results_json: JSON.stringify([
      { stage_index: 0, stage_name: 'Order Received', doer_name: 'Priya', doer_email: 'priya@example.com', status: 'COMPLETED_ON_TIME', plan: '2026-08-01T09:00:00.000Z', actual: '2026-08-01T09:05:00.000Z', variance_minutes: 5 },
      { stage_index: 1, stage_name: 'Invoicing', doer_name: 'Priya', doer_email: 'priya@example.com', status: 'OVERDUE', plan: '2026-08-04T09:00:00.000Z', actual: null, variance_minutes: 1440 },
    ]),
    is_closed: false, updated_at: '2026-08-04T09:00:00.000Z',
    ...overrides,
  };
}

describe('transformStatusCacheRow', () => {
  it('maps every Status_Cache column onto the normalized record shape', () => {
    const { record } = transformStatusCacheRow('fms_o2d', mkRow());
    expect(record.fmsId).toBe('fms_o2d');
    expect(record.recordId).toBe('REC-001');
    expect(record.rawRow).toBe(42);
    expect(record.displayName).toBe('Acme Corp');
    expect(record.recordStatus).toBe('OVERDUE');
    expect(record.completedSteps).toBe(3);
    expect(record.totalSteps).toBe(8);
    expect(record.freshness).toBe('Warning');
    expect(record.isClosed).toBe(false);
    expect(record.isArchived).toBe(false);
    expect(record.planTime?.toISOString()).toBe('2026-08-05T10:00:00.000Z');
    expect(record.delay).toEqual({ minutes: 90, hours: 1.5, days: 0.1, human: '1h 30m' });
  });

  it('flattens stage_results_json into one stage_event per stage, preserving order/index', () => {
    const { stageEvents } = transformStatusCacheRow('fms_o2d', mkRow());
    expect(stageEvents).toHaveLength(2);
    expect(stageEvents[0]).toMatchObject({ stageIndex: 0, stageName: 'Order Received', status: 'COMPLETED_ON_TIME', varianceMinutes: 5 });
    expect(stageEvents[1]).toMatchObject({ stageIndex: 1, stageName: 'Invoicing', status: 'OVERDUE', varianceMinutes: 1440 });
    expect(stageEvents[1].actualTime).toBeNull(); // still open, no actual date yet
  });

  it('treats an empty/blank date string as null, not an Invalid Date crash', () => {
    const { record } = transformStatusCacheRow('fms_o2d', mkRow({ plan_time_iso: '', last_update_iso: '' }));
    expect(record.planTime).toBeNull();
    expect(record.lastUpdate).toBeNull();
  });

  it('treats malformed JSON in delay_json/stage_results_json as null/empty rather than throwing', () => {
    const { record, stageEvents } = transformStatusCacheRow('fms_o2d', mkRow({ delay_json: '{not json', stage_results_json: '{not json' }));
    expect(record.delay).toBeNull();
    expect(stageEvents).toEqual([]);
  });

  it('accepts Sheets API boolean-as-string values (Sheets often returns "TRUE"/"FALSE" as strings)', () => {
    const { record } = transformStatusCacheRow('fms_o2d', mkRow({ is_closed: 'TRUE' as unknown as boolean, sequence_exception: 'FALSE' as unknown as boolean }));
    expect(record.isClosed).toBe(true);
    expect(record.sequenceException).toBe(false);
  });

  it('a record with no stages at all (blank stage_results_json) yields zero stage_events, not a crash', () => {
    const { stageEvents } = transformStatusCacheRow('fms_o2d', mkRow({ stage_results_json: '' }));
    expect(stageEvents).toEqual([]);
  });
});

describe('findArchivedRecordIds', () => {
  it('returns record ids that were known before but are missing from the current read', () => {
    expect(findArchivedRecordIds(['a', 'b', 'c'], ['a', 'c'])).toEqual(['b']);
  });

  it('returns empty when nothing was archived', () => {
    expect(findArchivedRecordIds(['a', 'b'], ['a', 'b', 'c'])).toEqual([]);
  });

  it('returns empty for a brand-new FMS with no previously-known records', () => {
    expect(findArchivedRecordIds([], ['a', 'b'])).toEqual([]);
  });
});
