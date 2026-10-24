import type { CaseSpec } from './types';

export interface TargetRequest {
  baseUrl: string;
  method: CaseSpec['method'];
  path?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  retries?: number;
}

export interface TargetResponse {
  status: number;
  body: unknown;
  bodyText: string;
  latencyMs: number;
}

export class TargetError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'TargetError';
    this.status = status;
  }
}

export async function callTarget(req: TargetRequest): Promise<TargetResponse> {
  const timeoutMs = req.timeoutMs ?? 30_000;
  const retries = req.retries ?? 0;
  const url = joinUrl(req.baseUrl, req.path);

  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const startedAt = now();
    try {
      const res = await fetchWithTimeout(url, req, timeoutMs);
      if (res.status >= 500 && attempt < retries) {
        await sleep(backoffMs(attempt));
        continue;
      }
      const bodyText = await res.text();
      const latencyMs = now() - startedAt;
      let body: unknown = bodyText;
      if (bodyText.length > 0) {
        const contentType = res.headers.get('content-type') ?? '';
        if (contentType.includes('json')) {
          try {
            body = JSON.parse(bodyText);
          } catch {
            body = bodyText;
          }
        }
      }
      return { status: res.status, body, bodyText, latencyMs };
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (attempt < retries && isRetryable(e)) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw new TargetError(`request to ${url} failed: ${lastError.message}`);
    }
  }
  throw lastError ?? new TargetError(`request to ${url} failed`);
}

function fetchWithTimeout(url: string, req: TargetRequest, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers: Record<string, string> = { accept: 'application/json', ...req.headers };
  let payload: string | undefined;
  if (req.body !== undefined) {
    payload = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    headers['content-type'] = headers['content-type'] ?? 'application/json';
  }
  return fetch(url, {
    method: req.method ?? 'POST',
    headers,
    body: payload,
    signal: controller.signal,
  }).finally(() => clearTimeout(timer));
}

function joinUrl(base: string, path?: string): string {
  if (!path) return base.replace(/\/+$/, '');
  const b = base.replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}${p}`;
}

function backoffMs(attempt: number): number {
  return 100 * 2 ** attempt + Math.floor(Math.random() * 50);
}

function isRetryable(e: unknown): boolean {
  return (
    (e instanceof DOMException && e.name === 'TimeoutError') ||
    (e instanceof TypeError && e.message.includes('fetch'))
  );
}

function now(): number {
  return performance.now();
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
