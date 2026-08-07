import { createServer } from 'node:http';
import type { ServerResponse } from 'node:http';

const PORT = Number(process.env.PORT ?? 3000);
const MODE = process.env.BENCHY_DEMO_MODE ?? 'v1';

interface TriageRequest {
  message?: string;
  channel?: string;
}

interface TriageResponse {
  category: 'billing' | 'bug' | 'account' | 'feature';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  sentiment: 'positive' | 'neutral' | 'negative';
  summary: string;
  model: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    model: string;
  };
}

const KEYWORDS = {
  billing: ['charge', 'charged', 'invoice', 'bill', 'billing', 'payment'],
  bug: ['down', 'outage', 'crash', 'crashes', 'broken', 'fails', '503', 'error'],
  account: ['login', 'log in', '2fa', 'password', 'lockout', 'locked out', 'update'],
  feature: ['feature', 'add', 'dark mode', 'installer', 'linux', 'would be nice'],
} as const;

function triage(message: string): TriageResponse {
  const text = ` ${message.toLowerCase()} `;
  const count = (words: readonly string[]): number =>
    words.reduce((acc, word) => acc + occurrenceCount(text, word), 0);

  const scores = {
    billing: count(KEYWORDS.billing),
    bug: count(KEYWORDS.bug),
    account: count(KEYWORDS.account),
    feature: count(KEYWORDS.feature),
  } as Record<'billing' | 'bug' | 'account' | 'feature', number>;

  scores.billing += count(['refund', 'money back']);
  if (MODE === 'v2') {
    scores.feature += count(['refund', 'money back']) * 10;
  }

  const ranking = (Object.entries(scores) as Array<[keyof typeof scores, number]>).sort(
    (a, b) => b[1] - a[1],
  );
  const category = ranking[0]![1] > 0 ? ranking[0]![0] : 'billing';

  const urgentSignals = count([
    'right now',
    'asap ',
    'urgent',
    'critical',
    'losing money',
    'immediately',
    ' now',
  ]);
  const loudSignals = count(['lockout', 'outage', 'down', 'crash', 'failing']);
  const priority: TriageResponse['priority'] =
    urgentSignals >= 2 ? 'urgent' : urgentSignals === 1 || loudSignals >= 1 ? 'high' : 'medium';

  const positive = count(['love', 'nice', 'thx', 'awesome', 'cool', 'dark', 'please']);
  const negative = count([
    'useless',
    'wrong',
    'broken',
    'hate',
    'suck',
    'charged',
    'fails',
    'failing',
    'outage',
    'down',
  ]);
  const sentiment: TriageResponse['sentiment'] =
    negative > positive ? 'negative' : positive > negative ? 'positive' : 'neutral';

  const lead = message.trim().split(/\s+/).slice(0, 6).join(' ');
  const summary =
    `${category} ticket (${priority} priority, ${sentiment}) about "${lead}"; ` +
    `reply within the same channel and ask for the account id.`;

  const promptTokens = 64 + Math.max(1, Math.ceil(message.length / 4));
  const completionTokens = 48 + Math.max(1, Math.ceil(summary.length / 4));
  return {
    category,
    priority,
    sentiment,
    summary,
    model: 'rule-triage-v1',
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
      model: 'rule-triage-v1',
    },
  };
}

function occurrenceCount(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = 0;
  for (;;) {
    idx = haystack.indexOf(needle, idx);
    if (idx === -1) break;
    count++;
    idx += needle.length;
  }
  return count;
}

function latencyFor(message: string): number {
  const base = Number(process.env.TRIAGE_DELAY_MS ?? 6);
  let hash = 0;
  for (const ch of message) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return base + (Math.abs(hash) % 7);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('access-control-allow-origin', '*');

  if (url.pathname === '/healthz' && req.method === 'GET') {
    respond(res, 200, { ok: true, mode: MODE });
    return;
  }

  if (url.pathname === '/v1/triage' && req.method === 'POST') {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      let body: TriageRequest = {};
      try {
        body = JSON.parse(raw) as TriageRequest;
      } catch {
        respond(res, 400, { error: 'request body must be JSON' });
        return;
      }
      const message = typeof body.message === 'string' ? body.message : '';
      if (message.length === 0) {
        respond(res, 400, { error: '"message" is required' });
        return;
      }
      const payload = triage(message);
      setTimeout(() => respond(res, 200, payload), latencyFor(message));
    });
    return;
  }

  respond(res, 404, { error: 'not found' });
});

function respond(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, { 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

server.listen(PORT, () => {
  console.log(`demo triage app (${MODE}) listening on http://localhost:${PORT}`);
});
