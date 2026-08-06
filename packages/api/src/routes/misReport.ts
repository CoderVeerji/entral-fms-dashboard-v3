import { Hono } from 'hono';
import { and, eq, inArray } from 'drizzle-orm';
import { fmsMaster, records, stageEvents, actionItems } from '@fms/db';
import { ok, AppError, STATUS, PENDING_RECORD_STATUSES } from '@fms/core';
import { requireAuth } from '../middleware/auth';
import { getSetting } from '../settings';
import type { Variables } from '../types';

// Direct successor to app/Code.gs's getMisReport — same DAILY/WEEKLY/MONTHLY period breakdown,
// now built from real SQL rows (records + stage_events) instead of scanning FMS_Records_Cache in
// JS. "Completed" metrics are scoped to stage events whose actualTime falls inside the period;
// "pending/overdue at end" metrics reflect each record's CURRENT status (not date-bound) — same
// distinction Code.gs's getMisReport made.
export const misReportRoutes = new Hono<{ Variables: Variables }>();

type ReportType = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

// yearParam is the FIRST calendar year of the Indian financial year (Apr 1 - Mar 31) — e.g.
// year=2026 means FY 2026-27, spanning 2026-04-01 to 2027-03-31.
function getPeriodRange(
  reportType: ReportType, dateParam: string | undefined, monthParam: string | undefined,
  yearParam: string | undefined, weekStartsMonday: boolean,
) {
  if (reportType === 'DAILY') {
    const d = dateParam ? new Date(dateParam) : new Date();
    const dayStr = d.toISOString().slice(0, 10);
    const start = new Date(`${dayStr}T00:00:00`);
    const end = new Date(`${dayStr}T23:59:59.999`);
    return { start, end, label: dayStr };
  }
  if (reportType === 'WEEKLY') {
    const base = dateParam ? new Date(dateParam) : new Date();
    const dow = base.getDay();
    const diff = weekStartsMonday ? (dow + 6) % 7 : dow;
    const start = new Date(base);
    start.setDate(base.getDate() - diff);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { start, end, label: `${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}` };
  }
  if (reportType === 'YEARLY') {
    const now = new Date();
    // A bare calendar date falls in the FY that started the most recent April 1st on/before it.
    const defaultFyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const fyStartYear = yearParam ? Number(yearParam) : defaultFyStartYear;
    const start = new Date(fyStartYear, 3, 1); // April 1
    const end = new Date(fyStartYear + 1, 2, 31, 23, 59, 59, 999); // March 31 next year
    return { start, end, label: `FY ${fyStartYear}-${String((fyStartYear + 1) % 100).padStart(2, '0')}` };
  }
  const monthBase = monthParam ? new Date(`${monthParam}-01`) : new Date();
  const start = new Date(monthBase.getFullYear(), monthBase.getMonth(), 1);
  const end = new Date(monthBase.getFullYear(), monthBase.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end, label: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}` };
}

interface StageBreakdownRow { key: string; completed: number; onTime: number; late: number }

misReportRoutes.get('/', requireAuth('reports.view'), async (c) => {
  const db = c.get('db');
  const q = c.req.query();
  const reportType = (q.reportType || 'DAILY').toUpperCase() as ReportType;
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(reportType)) {
    throw new AppError('INVALID_INPUT', 'reportType must be DAILY, WEEKLY, MONTHLY, or YEARLY.');
  }

  const weekStart = await getSetting(db, 'DEFAULT_WEEK_START', 'Monday');
  const range = getPeriodRange(reportType, q.date, q.month, q.year, weekStart === 'Monday');

  const fmsConditions = [eq(fmsMaster.isDeleted, false), eq(fmsMaster.active, true)];
  if (q.fmsId) fmsConditions.push(eq(fmsMaster.fmsId, q.fmsId));
  const configs = await db.select().from(fmsMaster).where(and(...fmsConditions));
  const fmsIds = configs.map((f) => f.fmsId);

  const metrics = {
    newRecords: 0, completed: 0, completedOnTime: 0, completedLate: 0, closingPending: 0, overdueAtEnd: 0,
    delayCarriedMinutes: 0, avgVarianceMinutes: null as number | null, openedActions: 0, resolvedActions: 0,
  };
  const fmsBreakdown: { fmsId: string; fmsName: string; newRecords: number; completed: number; onTime: number; late: number; pending: number; overdue: number }[] = [];
  const stageBreakdown: Record<string, StageBreakdownRow> = {};
  const doerBreakdown: Record<string, StageBreakdownRow> = {};
  let varianceSum = 0;
  let varianceCount = 0;

  if (fmsIds.length) {
    const recRows = await db.select().from(records).where(and(inArray(records.fmsId, fmsIds), eq(records.isArchived, false)));
    const evRows = await db.select().from(stageEvents).where(inArray(stageEvents.fmsId, fmsIds));

    const evByFms = new Map<string, typeof evRows>();
    evRows.forEach((e) => { const arr = evByFms.get(e.fmsId) ?? []; arr.push(e); evByFms.set(e.fmsId, arr); });
    const recByFms = new Map<string, typeof recRows>();
    recRows.forEach((r) => { const arr = recByFms.get(r.fmsId) ?? []; arr.push(r); recByFms.set(r.fmsId, arr); });

    for (const config of configs) {
      const recs = recByFms.get(config.fmsId) ?? [];
      const events = evByFms.get(config.fmsId) ?? [];
      const fmsMetric = { fmsId: config.fmsId, fmsName: config.fmsName, newRecords: 0, completed: 0, onTime: 0, late: 0, pending: 0, overdue: 0 };

      const eventsByRecordId = new Map<string, typeof events>();
      events.forEach((e) => { const arr = eventsByRecordId.get(e.recordId) ?? []; arr.push(e); eventsByRecordId.set(e.recordId, arr); });

      for (const rec of recs) {
        const inPeriodByPlan = rec.planTime && rec.planTime >= range.start && rec.planTime <= range.end;
        if (inPeriodByPlan && (rec.completedSteps ?? 0) === 0) { metrics.newRecords++; fmsMetric.newRecords++; }
        if (rec.recordStatus === STATUS.RECORD.OVERDUE || rec.recordStatus === STATUS.RECORD.STALLED) { metrics.overdueAtEnd++; fmsMetric.overdue++; }
        if (PENDING_RECORD_STATUSES.includes(rec.recordStatus)) {
          metrics.closingPending++; fmsMetric.pending++;
        }
      }

      for (const sr of events) {
        if (!sr.actualTime || sr.actualTime < range.start || sr.actualTime > range.end) continue;
        metrics.completed++; fmsMetric.completed++;
        const onTime = sr.status === STATUS.STAGE.COMPLETED_ON_TIME || sr.status === STATUS.STAGE.COMPLETED_EARLY;
        const late = sr.status === STATUS.STAGE.COMPLETED_LATE;
        if (onTime) { metrics.completedOnTime++; fmsMetric.onTime++; }
        if (late) {
          metrics.completedLate++; fmsMetric.late++;
          metrics.delayCarriedMinutes += Math.max(0, sr.varianceMinutes ?? 0);
        }
        if (sr.varianceMinutes != null) { varianceSum += sr.varianceMinutes; varianceCount++; }

        if (!stageBreakdown[sr.stageName]) stageBreakdown[sr.stageName] = { key: sr.stageName, completed: 0, onTime: 0, late: 0 };
        stageBreakdown[sr.stageName].completed++;
        if (onTime) stageBreakdown[sr.stageName].onTime++;
        if (late) stageBreakdown[sr.stageName].late++;

        if (sr.doerName) {
          if (!doerBreakdown[sr.doerName]) doerBreakdown[sr.doerName] = { key: sr.doerName, completed: 0, onTime: 0, late: 0 };
          doerBreakdown[sr.doerName].completed++;
          if (onTime) doerBreakdown[sr.doerName].onTime++;
          if (late) doerBreakdown[sr.doerName].late++;
        }
      }

      fmsBreakdown.push(fmsMetric);
    }
  }
  metrics.avgVarianceMinutes = varianceCount ? Math.round(varianceSum / varianceCount) : null;

  if (fmsIds.length) {
    const actionRows = await db.select().from(actionItems).where(and(inArray(actionItems.fmsId, fmsIds), eq(actionItems.isDeleted, false)));
    for (const a of actionRows) {
      if (a.createdAt && a.createdAt >= range.start && a.createdAt <= range.end) metrics.openedActions++;
      if (a.resolvedAt && a.resolvedAt >= range.start && a.resolvedAt <= range.end) metrics.resolvedActions++;
    }
  }

  const ratio = (b: StageBreakdownRow) => (b.completed ? b.onTime / b.completed : -1);
  // onTimePercent (0-100) is the single shared number the frontend's positive/minus scoring
  // toggle displays two ways: "{onTimePercent}%" (achievement framing) or "-{100-onTimePercent}%"
  // (penalty framing) — see MisReportPage's scoreMode toggle. Computed once here so both frontend
  // views and CSV export read the exact same number.
  const withPct = <T extends StageBreakdownRow>(rows: T[]): (T & { onTimePercent: number | null })[] =>
    rows.map((r) => ({ ...r, onTimePercent: r.completed ? Math.round((r.onTime / r.completed) * 1000) / 10 : null }));
  const stageArr = withPct(Object.values(stageBreakdown));
  const doerArr = withPct(Object.values(doerBreakdown));
  const fmsArr = fmsBreakdown.map((f) => ({ ...f, onTimePercent: f.completed ? Math.round((f.onTime / f.completed) * 1000) / 10 : null }));
  const bestStage = [...stageArr].sort((a, b) => ratio(b) - ratio(a))[0] ?? null;
  const worstStage = [...stageArr].sort((a, b) => ratio(a) - ratio(b))[0] ?? null;
  const bestDoer = [...doerArr].sort((a, b) => ratio(b) - ratio(a))[0] ?? null;
  const worstDoer = [...doerArr].sort((a, b) => ratio(a) - ratio(b))[0] ?? null;

  return c.json(ok({
    reportType, periodLabel: range.label, periodStart: range.start.toISOString(), periodEnd: range.end.toISOString(),
    metrics, fmsBreakdown: fmsArr, stageBreakdown: stageArr, doerBreakdown: doerArr,
    bestStage, worstStage, bestDoer, worstDoer,
  }));
});
