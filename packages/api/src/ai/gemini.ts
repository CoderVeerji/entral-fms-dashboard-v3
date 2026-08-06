// Thin fetch()-based wrapper around Gemini's REST generateContent endpoint — no @google/genai
// SDK, same reasoning that ruled out a raw TCP Postgres driver for Workers (avoid any risk of
// Node-API assumptions the Workers runtime doesn't support). Free tier, no card — see plan
// §"M7 — AI Assistant" for why Gemini was chosen over Claude/OpenAI's paid-only APIs.
//
// Uses the `gemini-flash-latest` alias rather than pinning a version: real-world testing during
// implementation found `gemini-2.5-flash` (this feature's original target model) already
// returning 404 "no longer available to new users", and `gemini-2.0-flash` returning 429 with a
// hard 0 free-tier quota on a freshly-created API key — Google rotates which model a given
// project gets free access to faster than this file should need re-deploying to keep up.
const GEMINI_MODEL = 'gemini-flash-latest';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

export interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
  // Newer Gemini models do internal "thinking" and reject a follow-up call whose function-call
  // turn doesn't echo this back verbatim (confirmed via a real API call during implementation —
  // omitting it fails with "Function call is missing a thought_signature"). Callers must pass the
  // whole `content` object from a prior GeminiCallResult back unchanged, never hand-construct a
  // model-role turn themselves.
  thoughtSignature?: string;
}

export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

export interface GeminiTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema (type: 'object', properties, required)
}

export interface GeminiCallResult {
  // The model's full turn, exactly as returned — echo this back verbatim as the next `contents`
  // entry when continuing the conversation (see thoughtSignature above).
  content: GeminiContent;
  text: string | null;
  functionCalls: { name: string; args: Record<string, unknown> }[];
}

export class GeminiError extends Error {
  status?: number;
  // Only set for a 429 — Gemini's own error body includes a suggested wait, e.g.
  // `"retryDelay":"15.8s"`. Real-world testing found this free-tier key's actual limit is 5
  // requests/minute (tighter than the ~10 RPM commonly cited), and this feature's tool-calling
  // loop can make several calls answering one question, so hitting this is expected occasional
  // behavior, not a bug to eliminate — see ai.ts's single-retry handling.
  retryAfterSeconds?: number;
}

export async function callGemini(apiKey: string, params: {
  systemInstruction?: string;
  contents: GeminiContent[];
  tools?: GeminiTool[];
}): Promise<GeminiCallResult> {
  const body: Record<string, unknown> = { contents: params.contents };
  if (params.systemInstruction) body.systemInstruction = { parts: [{ text: params.systemInstruction }] };
  if (params.tools?.length) body.tools = [{ functionDeclarations: params.tools }];

  const res = await fetch(`${GEMINI_BASE_URL}/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    const err = new GeminiError(`Gemini API HTTP ${res.status}: ${errBody.slice(0, 500)}`);
    err.status = res.status;
    if (res.status === 429) {
      const m = /"retryDelay":\s*"(\d+(?:\.\d+)?)s"/.exec(errBody);
      if (m) err.retryAfterSeconds = Math.ceil(Number(m[1]));
    }
    throw err;
  }

  const data = await res.json<{ candidates?: { content: GeminiContent; finishReason?: string }[] }>();
  const candidate = data.candidates?.[0];
  if (!candidate) throw new GeminiError('Gemini returned no candidates.');

  const content = candidate.content;
  const text = content.parts.filter((p) => p.text).map((p) => p.text).join('') || null;
  const functionCalls = content.parts.filter((p) => p.functionCall).map((p) => p.functionCall!);

  return { content, text, functionCalls };
}
