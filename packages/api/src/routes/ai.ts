import { Hono } from 'hono';
import { ok, AppError } from '@fms/core';
import { requireAuth } from '../middleware/auth';
import { callGemini, type GeminiContent } from '../ai/gemini';
import { AI_TOOLS, runAiTool } from '../ai/tools';
import type { Env } from '../env';
import type { Variables } from '../types';

export const aiRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const SYSTEM_INSTRUCTION = `You are the AI assistant embedded in Central FMS Dashboard, an internal operations-tracking tool for Le Fabco Pvt. Ltd. Staff use it to track records moving through a sequence of stages across several connected FMS (File Management Systems) — each record has a current stage, a doer (the person responsible), and a plan time.

Answer only using the tools provided — never guess or invent a number, FMS name, doer name, or status. If a tool returns nothing relevant, say so plainly instead of speculating. Keep answers concise and concrete, citing the actual numbers a tool returned. When something looks like a real problem (a high bottleneck score, a cluster of overdue records, a data-quality issue), say so directly and suggest one or two specific, actionable next steps grounded in what the tools returned — never generic advice unconnected to the real data.

Format answers in markdown: use a short bold summary line, a table (with a header row) whenever you're presenting more than two rows of comparable data (per-stage or per-doer breakdowns, several FMS side by side), and bullet points for recommendations. Keep tables narrow — only the columns that matter for the question asked, not every field a tool returned.`;

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
  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const result = await callGemini(apiKey, { systemInstruction: SYSTEM_INSTRUCTION, contents, tools: AI_TOOLS });
    contents.push(result.content);
    if (!result.functionCalls.length) { finalText = result.text; break; }

    for (const call of result.functionCalls) {
      const toolResult = await runAiTool(db, call.name, call.args);
      contents.push({ role: 'user', parts: [{ functionResponse: { name: call.name, response: { result: toolResult } } }] });
    }
  }

  if (finalText === null) {
    throw new AppError('AI_TOO_MANY_STEPS', 'The assistant took too many steps to answer — try asking a more specific question.');
  }

  return c.json(ok({ text: finalText }));
});
