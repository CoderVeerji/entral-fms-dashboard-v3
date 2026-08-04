// Response shape kept identical to app/Code.gs's ok_/fail_ (see plan §"Backend API") so the
// ported frontend needs minimal changes to its response-handling code — only the transport
// (fetch() instead of JSONP) and real HTTP status codes are new.
export interface OkEnvelope<T> {
  ok: true;
  data: T;
  message: string;
  meta: { generatedAt: string; cached: boolean; [key: string]: unknown };
}

export interface FailEnvelope {
  ok: false;
  message: string;
  code: string;
}

export function ok<T>(data: T, message = '', meta: Record<string, unknown> = {}): OkEnvelope<T> {
  return { ok: true, data, message, meta: { generatedAt: new Date().toISOString(), cached: false, ...meta } };
}

export function fail(code = 'ERROR', message = 'Request failed.'): FailEnvelope {
  return { ok: false, message, code };
}

export class AppError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}
