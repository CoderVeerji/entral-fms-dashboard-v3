import { Hono } from 'hono';
import { ok, AppError } from '@fms/core';
import { requireAuth } from '../middleware/auth';
import { callGroq, GroqError, type GroqMessage } from '../ai/groq';
import { AI_TOOLS, runAiTool } from '../ai/tools';
import type { Env } from '../env';
import type { Variables } from '../types';

export const aiRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const SYSTEM_INSTRUCTION = `You are the AI assistant embedded in Central FMS Dashboard, an internal operations-tracking tool for Le Fabco Pvt. Ltd. Staff use it to track records moving through a sequence of stages across several connected FMS (File Management Systems) — each record has a current stage, a doer (the person responsible), and a plan time.

Answer only using the tools provided — never guess or invent a number, FMS name, doer name, or status. If a tool returns nothing relevant, say so plainly instead of speculating. Keep answers concise and concrete, citing the actual numbers a tool returned. When something looks like a real problem (a cluster of overdue/stalled records, a low on-time percentage, a data-quality issue), say so directly and suggest one or two specific, actionable next steps grounded in what the tools returned — never generic advice unconnected to the real data.

Describe performance in terms a non-technical reader immediately understands: on-time percentage (onTimePercent) and real counts (assigned, completed, late, overdue, stalled — e.g. "471 of 900 stages were late, 90% on time"). NEVER state a raw bottleneckScore number by itself (e.g. "score: 3985.7") — it's an internal ranking value with no intuitive scale and reads as made up; use it only to decide which rows are worth mentioning, never to describe them. Rank/compare using words ("the worst-performing stage") backed by the real counts, not the score number.

Format answers in markdown: use a short bold summary line, a table (with a header row) whenever you're presenting more than two rows of comparable data (per-stage or per-doer breakdowns, several FMS side by side) — table columns should be percentages and counts, never a raw score column — and bullet points for recommendations. Keep tables narrow — only the columns that matter for the question asked. Every table row — the header, the |---|---| separator, and every data row — MUST be on its own line, separated by a real newline character. Never put more than one row on the same line; a table written on a single line will not render.

If answering needs more than one tool, request all of them together in the same turn rather than one at a time — each extra round trip costs real time against the rate limit.`;

// Bounds how many times the model can call a tool before answering — a runaway loop would burn
// through the free-tier quota fast, so this fails loud instead.
const MAX_TOOL_ITERATIONS = 5;

interface HistoryTurn { role: 'user' | 'assistant'; text: string }

// v1 is deliberately stateless (see plan §"M7 — Chat") — the client keeps the message list and
// resends it as `history` every call; nothing is persisted server-side. History turns are plain
// text only (never a raw tool_calls turn — those exist only inside this request's own
// tool-calling loop below and are discarded once a final answer is produced).
aiRoutes.post('/chat', requireAuth('ai.chat'), async (c) => {
  const apiKey = c.env.GROQ_API_KEY;
  if (!apiKey) throw new AppError('AI_NOT_CONFIGURED', 'GROQ_API_KEY is not set — the AI Assistant is unavailable until it is.');

  const db = c.get('db');
  const body = await c.req.json<{ message?: string; history?: HistoryTurn[] }>();
  const message = (body.message || '').trim();
  if (!message) throw new AppError('INVALID_INPUT', 'message is required.');

  const messages: GroqMessage[] = [{ role: 'system', content: SYSTEM_INSTRUCTION }];
  (body.history || []).filter((h) => h.text && h.text.trim()).forEach((h) => {
    messages.push({ role: h.role, content: h.text });
  });
  messages.push({ role: 'user', content: message });

  let finalText: string | null = null;
  try {
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const result = await callGroqWithRetry(apiKey, { messages, tools: AI_TOOLS });
      messages.push(result.message);
      if (!result.toolCalls.length) { finalText = result.text; break; }

      for (const call of result.toolCalls) {
        const toolResult = await runAiTool(db, call.name, call.args);
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(toolResult) });
      }
    }
  } catch (err) {
    // Never leak the provider's raw error JSON to the chat UI — translate to something a user
    // can act on.
    if (err instanceof GroqError && err.status === 429) {
      throw new AppError('AI_RATE_LIMITED', 'The AI Assistant is getting a lot of questions right now — please wait a moment and try again.');
    }
    throw new AppError('AI_ERROR', 'The AI Assistant had trouble answering that — please try again.');
  }

  if (finalText === null) {
    throw new AppError('AI_TOO_MANY_STEPS', 'The assistant took too many steps to answer — try asking a more specific question.');
  }

  return c.json(ok({ text: finalText }));
});

// One retry, after the provider's own suggested wait if given (capped) — matches REBUILD_PLAN's
// "no retry storms" principle: a single bounded retry for a transient rate limit, not a loop.
async function callGroqWithRetry(apiKey: string, params: Parameters<typeof callGroq>[1]) {
  try {
    return await callGroq(apiKey, params);
  } catch (err) {
    if (err instanceof GroqError && err.status === 429) {
      const waitSeconds = Math.min(err.retryAfterSeconds ?? 5, 15);
      await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
      return await callGroq(apiKey, params);
    }
    throw err;
  }
}
