// Groq's Chat Completions API — OpenAI-compatible format, no SDK (thin fetch() wrapper, same
// Workers-runtime-safety reasoning as everywhere else this app talks to a REST API directly).
// Replaced an earlier Gemini-based client (see git history) once real use showed Gemini's
// free-tier limit (5 requests/minute on the key tested) was too tight for a tool-calling chat
// feature — one question already costs 2+ calls before any retry. Groq's free tier is
// dramatically more generous — 30 requests/minute, 14,400/day, no card, confirmed via a real API
// call during implementation — and every model on the platform is included, no per-model quota
// surprises like Gemini's (where one model had a hard 0 free quota on the same key).
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

export interface GroqToolCall {
  id: string;
  function: { name: string; arguments: string };
}

export interface GroqMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: GroqToolCall[];
  tool_call_id?: string;
}

export interface GroqTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema (type: 'object', properties, required)
}

export interface GroqCallResult {
  // Echo this back verbatim as the next `messages[]` entry when continuing the conversation.
  message: GroqMessage;
  text: string | null;
  toolCalls: { id: string; name: string; args: Record<string, unknown> }[];
}

export class GroqError extends Error {
  status?: number;
  retryAfterSeconds?: number;
}

export async function callGroq(apiKey: string, params: {
  messages: GroqMessage[];
  tools?: GroqTool[];
}): Promise<GroqCallResult> {
  const body: Record<string, unknown> = { model: GROQ_MODEL, messages: params.messages };
  if (params.tools?.length) {
    body.tools = params.tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    const err = new GroqError(`Groq API HTTP ${res.status}: ${errBody.slice(0, 500)}`);
    err.status = res.status;
    if (res.status === 429) {
      const retryHeader = res.headers.get('retry-after');
      if (retryHeader && !Number.isNaN(Number(retryHeader))) err.retryAfterSeconds = Math.ceil(Number(retryHeader));
    }
    throw err;
  }

  const data = await res.json<{ choices?: { message: GroqMessage; finish_reason?: string }[] }>();
  const choice = data.choices?.[0];
  if (!choice) throw new GroqError('Groq returned no choices.');

  const message = choice.message;
  const toolCalls = (message.tool_calls || []).map((tc) => {
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(tc.function.arguments || '{}'); } catch { /* malformed args from the model — leave empty */ }
    return { id: tc.id, name: tc.function.name, args };
  });

  return { message, text: message.content, toolCalls };
}
