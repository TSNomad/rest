/**
 * Fakes the REST tests share: a request, a response, a response factory
 * and a recording logger.
 */

import type { Request, Response, ResponseFactory } from '@tsnomad/http';
import type { LogContext, LoggerLevel, LoggerStrategy } from '@tsnomad/logger';

export class FakeRequest implements Request {
  private headers = new Map<string, string>();
  constructor(private params: Record<string, unknown> = {}, headers: Record<string, string> = {}, private body = '') {
    for (const [name, value] of Object.entries(headers)) this.headers.set(name.toLowerCase(), value);
  }
  getHeader(name: string) { return this.headers.get(name.toLowerCase()) ?? null; }
  setHeader(name: string, value: string) { this.headers.set(name.toLowerCase(), value); }
  getHeaders() { return Object.fromEntries(this.headers); }
  getParam(name: string) { return Object.hasOwn(this.params, name) ? this.params[name] : null; }
  hasParam(name: string) { return Object.hasOwn(this.params, name); }
  setParam(name: string, value: unknown) { this.params[name] = value; }
  removeParam(name: string) { delete this.params[name]; }
  getBody() { return this.body; }
  getParams() { return { ...this.params }; }
}

export class FakeResponse implements Response {
  status = 200;
  headers: Record<string, string> = {};
  body = '';
  error: string | null = null;
  constructor(readonly label = 'fake') {}
  setStatus(code: number) { this.status = code; return this; }
  getStatus() { return this.status; }
  setHeader(name: string, value: string) { this.headers[name.toLowerCase()] = value; return this; }
  getHeader(name: string) { return this.headers[name.toLowerCase()] ?? null; }
  getHeaders() { return { ...this.headers }; }
  setBody(body: string) { this.body = body; return this; }
  setJson(data: unknown) { this.body = JSON.stringify(data); this.headers['content-type'] = 'application/json'; return this; }
  getJson() { return JSON.parse(this.body) as unknown; }
  getBody() { return this.body; }
  setError(message: string, code = 400) { this.error = message; this.status = code; return this.setJson({ error: message }); }
  getErrorMessage() { return this.error; }
  getResponse() { return { status: this.status, body: this.body }; }
}

export class FakeResponseFactory implements ResponseFactory {
  readonly created: FakeResponse[] = [];
  create(): FakeResponse {
    const response = new FakeResponse('from-factory');
    this.created.push(response);
    return response;
  }
}

export type LogCall = { method: string; args: unknown[] };

export class RecordingLogger implements LoggerStrategy {
  readonly calls: LogCall[] = [];
  private record(method: string, args: unknown[]) { this.calls.push({ method, args }); }
  emergency(message: string, context?: LogContext) { this.record('emergency', [message, context]); }
  alert(message: string, context?: LogContext) { this.record('alert', [message, context]); }
  critical(message: string, context?: LogContext) { this.record('critical', [message, context]); }
  error(message: string, context?: LogContext) { this.record('error', [message, context]); }
  warning(message: string, context?: LogContext) { this.record('warning', [message, context]); }
  notice(message: string, context?: LogContext) { this.record('notice', [message, context]); }
  info(message: string, context?: LogContext) { this.record('info', [message, context]); }
  debug(message: string, context?: LogContext) { this.record('debug', [message, context]); }
  logException(error: unknown, message?: string, context?: LogContext, level?: LoggerLevel) {
    this.record('logException', [error, message, context, level]);
  }
}

/** Resolves after other queued work has had a turn, to make a stage truly async. */
export function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
