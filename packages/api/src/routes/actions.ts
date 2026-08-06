import { Hono } from 'hono';
import { and, desc, eq, asc, sql } from 'drizzle-orm';
import { actionItems, actionComments } from '@fms/db';
import { ok, AppError, ACTION_TYPES, ACTION_STATUSES, ACTION_PRIORITIES, generateId } from '@fms/core';
import { requireAuth } from '../middleware/auth';
import { sendEmail, actionReminderEmailHtml } from '../email';
import { getSetting } from '../settings';
import { logAudit } from '../audit';
import type { Env } from '../env';
import type { Variables } from '../types';

// Direct successor to app/Code.gs's getActionItems/saveActionItem/saveActionComment/
// getActionComments/updateActionStatus/deleteActionItem/sendActionReminder.
export const actionsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const ACTION_ITEMS_HARD_CAP = 3000;

actionsRoutes.get('/', requireAuth('actions.view'), async (c) => {
  const db = c.get('db');
  const q = c.req.query();

  const conditions = [eq(actionItems.isDeleted, false)];
  if (q.fmsId) conditions.push(eq(actionItems.fmsId, q.fmsId));
  if (q.status) conditions.push(eq(actionItems.status, q.status));
  if (q.priority) conditions.push(eq(actionItems.priority, q.priority));
  if (q.assignedTo) conditions.push(eq(actionItems.assignedTo, q.assignedTo));
  if (q.search && q.search.trim()) {
    const term = `%${q.search.trim()}%`;
    conditions.push(sql`(${actionItems.title} || ' ' || coalesce(${actionItems.recordDisplay}, '')) ILIKE ${term}`);
  }

  const rows = await db.select().from(actionItems).where(and(...conditions))
    .orderBy(desc(actionItems.createdAt)).limit(ACTION_ITEMS_HARD_CAP);

  return c.json(ok(rows));
});

interface SaveActionPayload {
  actionId?: string;
  fmsId?: string;
  recordId?: string;
  recordDisplay?: string;
  stageName?: string;
  actionType?: string;
  priority?: string;
  title?: string;
  description?: string;
  assignedTo?: string;
  assignedEmail?: string;
  dueAt?: string;
}

actionsRoutes.post('/', requireAuth(), async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const payload = await c.req.json<SaveActionPayload>();

  if (!payload.title?.trim()) throw new AppError('INVALID_INPUT', 'Title is required.');
  if (!ACTION_TYPES.includes(payload.actionType as (typeof ACTION_TYPES)[number])) throw new AppError('INVALID_INPUT', 'Invalid action type.');
  if (!ACTION_PRIORITIES.includes(payload.priority as (typeof ACTION_PRIORITIES)[number])) throw new AppError('INVALID_INPUT', 'Invalid priority.');

  if (payload.actionId) {
    if (!session.permissions['actions.edit']) throw new AppError('FORBIDDEN', 'You do not have permission to perform this action.');
    const [existing] = await db.select().from(actionItems)
      .where(and(eq(actionItems.actionId, payload.actionId), eq(actionItems.isDeleted, false))).limit(1);
    if (!existing) throw new AppError('NOT_FOUND', 'Action item not found.');

    await db.update(actionItems).set({
      title: payload.title, description: payload.description ?? '', actionType: payload.actionType,
      priority: payload.priority, assignedTo: payload.assignedTo ?? '', assignedEmail: payload.assignedEmail ?? '',
      dueAt: payload.dueAt ? new Date(payload.dueAt) : null,
    }).where(eq(actionItems.actionId, payload.actionId));
    await logAudit(db, { username: session.username, role: session.roleId, action: 'ACTION_UPDATE', module: 'actions', recordId: payload.actionId });

    return c.json(ok(true, 'Action item updated.'));
  }

  if (!session.permissions['actions.add']) throw new AppError('FORBIDDEN', 'You do not have permission to perform this action.');
  const id = generateId('act');
  await db.insert(actionItems).values({
    actionId: id, fmsId: payload.fmsId ?? '', recordId: payload.recordId ?? '', recordDisplay: payload.recordDisplay ?? '',
    stageName: payload.stageName ?? '', actionType: payload.actionType!, priority: payload.priority!,
    title: payload.title, description: payload.description ?? '', assignedTo: payload.assignedTo ?? '',
    assignedEmail: payload.assignedEmail ?? '', createdBy: session.username, status: 'Open',
    dueAt: payload.dueAt ? new Date(payload.dueAt) : null,
  });
  await logAudit(db, { username: session.username, role: session.roleId, action: 'ACTION_CREATE', module: 'actions', recordId: id });

  return c.json(ok({ actionId: id }, 'Action item created.'));
});

actionsRoutes.get('/:actionId/comments', requireAuth('actions.view'), async (c) => {
  const db = c.get('db');
  const { actionId } = c.req.param();
  const rows = await db.select().from(actionComments)
    .where(and(eq(actionComments.actionId, actionId), eq(actionComments.isDeleted, false)))
    .orderBy(asc(actionComments.createdAt));
  return c.json(ok(rows));
});

actionsRoutes.post('/:actionId/comments', requireAuth('actions.edit'), async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const { actionId } = c.req.param();
  const { comment } = await c.req.json<{ comment?: string }>();
  if (!comment?.trim()) throw new AppError('INVALID_INPUT', 'Comment text is required.');

  const [action] = await db.select().from(actionItems)
    .where(and(eq(actionItems.actionId, actionId), eq(actionItems.isDeleted, false))).limit(1);
  if (!action) throw new AppError('NOT_FOUND', 'Action item not found.');

  await db.insert(actionComments).values({
    commentId: generateId('cmt'), actionId, comment, createdBy: session.username,
  });
  await db.update(actionItems).set({ lastCommentAt: new Date() }).where(eq(actionItems.actionId, actionId));
  await logAudit(db, { username: session.username, role: session.roleId, action: 'ACTION_COMMENT', module: 'actions', recordId: actionId });

  return c.json(ok(true, 'Comment added.'));
});

actionsRoutes.patch('/:actionId/status', requireAuth(), async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const { actionId } = c.req.param();
  const { status, resolution } = await c.req.json<{ status?: string; resolution?: string }>();

  if (!status || !ACTION_STATUSES.includes(status as (typeof ACTION_STATUSES)[number])) throw new AppError('INVALID_INPUT', 'Invalid status.');
  const requiredPerm = status === 'Resolved' ? 'actions.close' : 'actions.edit';
  if (!session.permissions[requiredPerm]) throw new AppError('FORBIDDEN', 'You do not have permission to perform this action.');

  const [action] = await db.select().from(actionItems)
    .where(and(eq(actionItems.actionId, actionId), eq(actionItems.isDeleted, false))).limit(1);
  if (!action) throw new AppError('NOT_FOUND', 'Action item not found.');

  if (status === 'Resolved') {
    await db.update(actionItems).set({
      status, resolvedBy: session.username, resolvedAt: new Date(), resolution: resolution ?? '',
    }).where(eq(actionItems.actionId, actionId));
  } else {
    await db.update(actionItems).set({
      status, resolvedBy: '', resolvedAt: null, resolution: '',
    }).where(eq(actionItems.actionId, actionId));
  }
  await logAudit(db, {
    username: session.username, role: session.roleId,
    action: 'ACTION_STATUS_' + status.toUpperCase().replace(/\s/g, '_'), module: 'actions', recordId: actionId,
  });

  return c.json(ok(true, 'Status updated.'));
});

actionsRoutes.delete('/:actionId', requireAuth('actions.delete'), async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  if (session.roleId !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'Only Super Admin can delete action items.');
  const { actionId } = c.req.param();

  const result = await db.update(actionItems).set({ isDeleted: true })
    .where(and(eq(actionItems.actionId, actionId), eq(actionItems.isDeleted, false)))
    .returning({ actionId: actionItems.actionId });
  if (!result.length) throw new AppError('NOT_FOUND', 'Action item not found.');
  await logAudit(db, { username: session.username, role: session.roleId, action: 'ACTION_DELETE', module: 'actions', recordId: actionId });

  return c.json(ok(true, 'Action item deleted.'));
});

interface ReminderPayload {
  email?: string;
  fmsName?: string;
  recordDisplay?: string;
  stageName?: string;
  planTime?: string;
  delayHuman?: string;
}

actionsRoutes.post('/:actionId/remind', requireAuth('actions.edit'), async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const { actionId } = c.req.param();
  const emailNotifsEnabled = await getSetting(db, 'EMAIL_NOTIFICATIONS_ENABLED', 'false');
  if (emailNotifsEnabled !== 'true') throw new AppError('EMAIL_DISABLED', 'Email notifications are disabled in Settings.');

  const payload = await c.req.json<ReminderPayload>();
  const email = (payload.email ?? '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError('INVALID_INPUT', 'A valid recipient email is required.');

  const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, GMAIL_SENDER_EMAIL } = c.env;
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN || !GMAIL_SENDER_EMAIL) {
    throw new AppError('EMAIL_FAILED', 'Email sending is not configured.');
  }

  const sendResult = await sendEmail(
    { clientId: GMAIL_CLIENT_ID, clientSecret: GMAIL_CLIENT_SECRET, refreshToken: GMAIL_REFRESH_TOKEN, senderEmail: GMAIL_SENDER_EMAIL },
    email, `Reminder: ${payload.fmsName ?? 'A record'} needs attention`,
    actionReminderEmailHtml(payload.fmsName ?? '', payload.recordDisplay ?? '', payload.stageName ?? '', payload.planTime ?? '', payload.delayHuman ?? 'N/A'),
    `FMS: ${payload.fmsName ?? ''}\nRecord: ${payload.recordDisplay ?? ''}\nStage: ${payload.stageName ?? ''}\nPlan Time: ${payload.planTime ?? ''}\nDelay: ${payload.delayHuman ?? 'N/A'}`,
  );
  if (!sendResult.ok) {
    await logAudit(db, { username: session.username, role: session.roleId, action: 'EMAIL_REMINDER', module: 'actions', recordId: actionId, success: false, errorMessage: sendResult.error });
    throw new AppError('EMAIL_FAILED', 'Could not send email.');
  }
  await logAudit(db, { username: session.username, role: session.roleId, action: 'EMAIL_REMINDER', module: 'actions', recordId: actionId, details: { email } });

  return c.json(ok(true, `Reminder email sent to ${email}.`));
});
