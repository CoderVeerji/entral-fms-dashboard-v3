import { describe, it, expect } from 'vitest';
import { dedupeAndFindDuplicates, type NormalizedRow } from './dataHealth';
import type { NormalizedRecord } from './transform';

function mkRow(recordId: string, displayName: string): NormalizedRow {
  const record: NormalizedRecord = {
    fmsId: 'fms_test', recordId, rawRow: 1, displayName, currentStage: 'Stage A', doer: '', doerEmail: '',
    planTime: null, recordStatus: 'RUNNING_ON_TIME', delay: null, completedSteps: 0, totalSteps: 1,
    lastUpdate: null, freshness: 'Fresh', sequenceException: false, isClosed: false, isArchived: false, details: null,
  };
  return { record, stageEvents: [] };
}

describe('dedupeAndFindDuplicates', () => {
  it('returns everything unchanged and no duplicates when every record_id is unique', () => {
    const input = [mkRow('r1', 'A'), mkRow('r2', 'B'), mkRow('r3', 'C')];
    const { deduped, duplicateIds } = dedupeAndFindDuplicates(input);
    expect(deduped).toHaveLength(3);
    expect(duplicateIds).toEqual([]);
  });

  it('flags a duplicate record_id and keeps only the LAST occurrence (matches the publisher convention)', () => {
    const input = [mkRow('r1', 'First Copy'), mkRow('r2', 'B'), mkRow('r1', 'Second Copy')];
    const { deduped, duplicateIds } = dedupeAndFindDuplicates(input);
    expect(duplicateIds).toEqual(['r1']);
    expect(deduped).toHaveLength(2);
    expect(deduped.find((r) => r.record.recordId === 'r1')?.record.displayName).toBe('Second Copy');
  });

  it('handles a record_id duplicated more than twice, reporting it once', () => {
    const input = [mkRow('r1', 'A'), mkRow('r1', 'B'), mkRow('r1', 'C')];
    const { deduped, duplicateIds } = dedupeAndFindDuplicates(input);
    expect(duplicateIds).toEqual(['r1']);
    expect(deduped).toHaveLength(1);
  });

  it('empty input produces empty output, not an error', () => {
    const { deduped, duplicateIds } = dedupeAndFindDuplicates([]);
    expect(deduped).toEqual([]);
    expect(duplicateIds).toEqual([]);
  });
});
