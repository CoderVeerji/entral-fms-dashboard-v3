import { Hono } from 'hono';
import { ok, AppError } from '@fms/core';
import { requireAuth } from '../middleware/auth';
import { callGemini, GeminiError, type GeminiContent } from '../ai/gemini';
import { AI_TOOLS, runAiTool } from '../ai/tools';
import type { Env } from '../env';
import type { Variables } from '../types';

export const aiRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const SYSTEM_INSTRUCTION = `You are the AI assistant embedded in Central FMS Dashboard, an internal operations-tracking tool for Le Fabco Pvt. Ltd. Staff use it to track records moving through a sequence of stages across several connected FMS (File Management Systems) — each record has a current stage, a doer (the person responsible), and a plan time.

Answer only using the tools provided — never guess or invent a number, FMS name, doer name, or status. If a tool returns nothing relevant, say so plainly instead of speculating. Keep answers concise and concrete, citing the actual numbers a tool returned. When something looks like a real problem (a cluster of overdue/stalled records, a low on-time percentage, a data-quality issue), say so directly and suggest one or two specific, actionable next steps grounded in what the tools returned — never generic advice unconnected to the real data.

Describe performance in terms a non-technical reader immediately understands: on-time percentage (onTimePercent) and real counts (assigned, completed, late, overdue, stalled — e.g. "471 of 900 stages were late, 90% on time"). NEVER state a raw bottleneckScore number by itself (e.g. "score: 3985.7") — it's an internal ranking value with no intuitive scale and reads as made up; use it only to decide which rows are worth mentioning, never to describe them. Rank/compare using words ("the worst-performing stage") backed by the real counts, not the score number.

Format answers in markdown: use a short bold summary line, a table (with a header row) whenever you're presenting more than two rows of comparable data (per-stage or per-doer breakdowns, several FMS side by side) — table columns should be percentages and counts, never a raw score column — and bullet points for recommendations. Keep tables narrow — only the columns that matter for the question asked.

If answering needs more than one tool, request all of them together in the same turn rather than one at a time — each extra round trip costs real time against a tight rate limit.`;

// Bounds how many times the model can call a tool before answering — a runaway loop would burn
// through Gemini's free-tier daily quota fast (see plan §"M7"), so this fails loud instead.
const MAX_TOOL_ITERATIONS = 5;

interface HistoryTurn { role: 'user' | 'model'; text: string }

// v1 is deliberately stateless (see plan §"M7 — Chat") — the client keeps the message list and
// resends it as `history` every call; nothing is persisted server-side. History turns are plain
// text only (never a raw functionCall/thoughtSignature turn — those exist only inside this
// request's own tool-calling loop below and are discarded once a final answer is produced), so
// reconstructing `contents` from client-supplied history never risks Gemini's "missing
// thought_signature" requirement, which only applies to function-call turns (confirmed against
// the real API during implementation).
aiRoutes.post('/chat', requireAuth('ai.chat'), async (c) => {
  const apiKey = c.env.GEMINI_API_KEY;
  if (!apiKey) throw new AppError('AI_NOT_CONFIGURED', 'GEMINI_API_KEY is not set — the AI Assistant is unavailable until it is.');

  const db = c.get('db');
  const body = await c.req.json<{ message?: string; history?: HistoryTurn[] }>();
  const message = (body.message || '').trim();
  if (!message) throw new AppError('INVALID_INPUT', 'message is required.');

  const contents: GeminiContent[] = (body.history || [])
    .filter((h) => h.text && h.text.trim())
    .map((h) => ({ role: h.role, parts: [{ text: h.text }] }));
  contents.push({ role: 'user', parts: [{ text: message }] });

  let finalText: string | null = null;
  try {
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const result = await callGeminiWithRetry(apiKey, { systemInstruction: SYSTEM_INSTRUCTION, contents, tools: AI_TOOLS });
      contents.push(result.content);
      if (!result.functionCalls.length) { finalText = result.text; break; }

      for (const call of result.functionCalls) {
        const toolResult = await runAiTool(db, call.name, call.args);
        contents.push({ role: 'user', parts: [{ functionResponse: { name: call.name, response: { result: toolResult } } }] });
      }
    }
  } catch (err) {
    // Never leak Gemini's raw error JSON to the chat UI — translate to something a user can act
    // on. 429 is expected occasional behavior here, not a bug: real-world testing found this
    // free-tier key's actual limit is 5 requests/minute, and one question can cost several calls.
    if (err instanceof GeminiError && err.status === 429) {
      throw new AppError('AI_RATE_LIMITED', 'The AI Assistant is on a free plan limited to a few questions per minute — please wait about a minute before trying again.');
    }
    throw new AppError('AI_ERROR', 'The AI Assistant had trouble answering that — please try again.');
  }

  if (finalText === null) {
    throw new AppError('AI_TOO_MANY_STEPS', 'The assistant took too many steps to answer — try asking a more specific question.');
  }

  return c.json(ok({ text: finalText }));
});

// One retry, after Gemini's own suggested wait (capped) — matches REBUILD_PLAN's "no retry
// storms" principle: a single bounded retry for a transient rate limit, not a loop. Real-world
// testing found this key's free-tier limit (5 requests/minute) tight enough that even a fresh
// manual retry ~20s later can still 429 — the fix that actually matters more than a longer/more
// aggressive retry here is using fewer Gemini calls per question in the first place (see the
// system prompt's "request tools together" instruction above), since each question already costs
// at least 2 calls (decide → answer) before any retry.
async function callGeminiWithRetry(apiKey: string, params: Parameters<typeof callGemini>[1]) {
  try {
    return await callGemini(apiKey, params);
  } catch (err) {
    if (err instanceof GeminiError && err.status === 429) {
      const waitSeconds = Math.min(err.retryAfterSeconds ?? 10, 25);
      await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
      return await callGemini(apiKey, params);
    }
    throw err;
  }
}
