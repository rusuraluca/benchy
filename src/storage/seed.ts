import type { Store } from './store';
import { buildSummary } from '../core/runner';
import type { CaseOutcome, CaseSpec, ScorerOutcome } from '../core/types';

const SEEDED_MODEL = 'rule-triage-v1';

const PRICING: Record<string, { input: number; output: number }> = {
  'rule-triage-v1': { input: 0.1, output: 0.1 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
};

interface SeedCaseMeta {
  id: string;
  title: string;
  category: string;
  outTokens: number;
  message: string;
}

const CASES: SeedCaseMeta[] = [
  {
    id: 'triage-simple-complaint',
    title: 'Triage: simple complaint',
    category: 'billing',
    outTokens: 60,
    message: 'You charged me twice this month.',
  },
  {
    id: 'triage-billing-refund',
    title: 'Triage: billing refund request',
    category: 'billing',
    outTokens: 70,
    message: 'I want a refund for the last invoice.',
  },
  {
    id: 'triage-urgent-outage',
    title: 'Triage: urgent outage report',
    category: 'bug',
    outTokens: 80,
    message: 'Your service is down for our whole team, we are losing money right now.',
  },
  {
    id: 'triage-account-lockout',
    title: 'Triage: account lockout',
    category: 'account',
    outTokens: 65,
    message: 'I cannot log in anymore, 2FA keeps failing.',
  },
  {
    id: 'triage-feature-request',
    title: 'Triage: feature request',
    category: 'feature',
    outTokens: 60,
    message: 'Please add dark mode to the dashboard.',
  },
  {
    id: 'triage-multi-issue',
    title: 'Triage: multi-issue email',
    category: 'bug',
    outTokens: 90,
    message: 'Billing is broken and the mobile app crashes on startup.',
  },
  {
    id: 'triage-culture-lede',
    title: 'Triage: casual wording',
    category: 'feature',
    outTokens: 65,
    message: 'yo would be cool if you shipped a linux installer, thx!',
  },
  {
    id: 'triage-rude-customer',
    title: 'Triage: rude customer',
    category: 'billing',
    outTokens: 75,
    message: 'You people are useless, fix the invoice NOW.',
  },
  {
    id: 'schema-decision-shape',
    title: 'Schema: decision shape',
    category: 'bug',
    outTokens: 100,
    message: 'Critical: our API calls fail with 503 every afternoon.',
  },
  {
    id: 'schema-priority-levels',
    title: 'Schema: priority levels',
    category: 'billing',
    outTokens: 55,
    message: 'The invoice total is wrong again.',
  },
  {
    id: 'judge-handoff-quality',
    title: 'Judge: handoff message quality',
    category: 'account',
    outTokens: 120,
    message: 'Everything broke after the latest update.',
  },
];

interface SeedRunSpec {
  label: string;
  baseLatency: number;
  jitter: number;
  failures: Record<string, string>;
}

const RUNS: SeedRunSpec[] = [
  { label: 'v1.0', baseLatency: 34, jitter: 6, failures: {} },
  { label: 'v1.1', baseLatency: 29, jitter: 5, failures: {} },
  { label: 'v1.2', baseLatency: 31, jitter: 7, failures: {} },
  {
    label: 'v1.3',
    baseLatency: 38,
    jitter: 9,
    failures: {
      'triage-billing-refund': 'output differs at $.category (expected "billing", got "feature")',
      'schema-decision-shape': 'schema validation failed: $ missing required property "priority"',
    },
  },
  { label: 'v1.4 (rollback)', baseLatency: 30, jitter: 6, failures: {} },
];

const SCHEMA_SHAPE = {
  type: 'object',
  required: ['category', 'priority', 'sentiment', 'summary'],
  additionalProperties: true,
  properties: {
    category: { type: 'string', enum: ['billing', 'bug', 'account', 'feature'] },
    priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
    sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative'] },
    summary: { type: 'string' },
  },
};

export function seedDemoRuns(store: Store, onlyIfEmpty: boolean): number {
  if (onlyIfEmpty && store.countRuns() > 0) return 0;

  const random = mulberry32(42);
  let tick = 1_700_000_000_000;
  for (const spec of RUNS) {
    const outcomes = CASES.map((meta, index) => seedCase(spec, meta, index, random));
    const summary = buildSummary(outcomes, 900 + Math.floor(random() * 400));
    store.createRun({
      label: spec.label,
      startedAt: new Date(tick).toISOString(),
      config: {
        name: 'support-triage-demo',
        target: { url: 'http://demo-app:3000', model: SEEDED_MODEL },
        pricing: PRICING,
        judge: { model: 'gpt-4o-mini' },
      },
      outcomes,
      summary,
      status: summary.failed === 0 && summary.errored === 0 ? 'passed' : 'failed',
    });
    tick += 86_400_000;
  }
  return RUNS.length;
}

function seedCase(
  spec: SeedRunSpec,
  meta: SeedCaseMeta,
  index: number,
  random: () => number,
): CaseOutcome {
  const failure = spec.failures[meta.id];
  const latency = Math.max(1, spec.baseLatency + (random() - 0.5) * 2 * spec.jitter);
  const tokensIn = 110;
  const tokensOut = meta.outTokens;
  const price = PRICING[SEEDED_MODEL]!;
  const cost = (tokensIn / 1_000_000) * price.input + (tokensOut / 1_000_000) * price.output;

  const isJudge = meta.id === 'judge-handoff-quality';
  const isSchema = meta.id.startsWith('schema-');

  const caseSpec: CaseSpec = {
    id: meta.id,
    name: meta.title,
    tags: ['triage'],
    method: 'POST',
    path: '/v1/triage',
    input: { message: meta.message },
    expected: isJudge
      ? {
          judge: {
            criteria:
              'The handoff must be professional, specific and actionable, and must name a concrete next step for the agent taking over.',
            required: false,
          },
        }
      : isSchema
        ? { schema: SCHEMA_SHAPE }
        : { output: { category: meta.category } },
    required: true,
    timeoutMs: 10_000,
    retries: 0,
  };

  const fallbackCategory = meta.id === 'triage-billing-refund' ? 'feature' : 'bug';
  const body = {
    category: failure ? fallbackCategory : meta.category,
    priority: meta.category === 'bug' ? (failure ? 'medium' : 'urgent') : 'medium',
    sentiment: meta.category === 'billing' ? 'negative' : 'neutral',
    summary: `Ticket about ${meta.category === 'billing' ? 'billing' : 'the app'}`,
  };
  if (failure && meta.id === 'schema-decision-shape') {
    delete (body as { priority?: string }).priority;
  }

  const scorers: ScorerOutcome[] = isJudge
    ? [
        {
          name: 'judge',
          status: failure ? 'failed' : 'passed',
          detail: failure
            ? 'judge: handoff is vague and does not name a next step (score 41/100)'
            : 'judge: clear, professional handoff with a named first step (score 92/100)',
          reason: failure ? 'handoff is vague' : 'clear handoff',
          usage: { in: 420, out: 90, model: 'gpt-4o-mini', source: 'judge' },
        },
      ]
    : isSchema
      ? [
          {
            name: 'schema',
            status: failure ? 'failed' : 'passed',
            detail: failure ?? 'schema valid',
          },
        ]
      : [
          {
            name: 'exact',
            status: failure ? 'failed' : 'passed',
            detail: failure ?? 'output matches expected',
          },
        ];

  return {
    index,
    spec: caseSpec,
    status: failure ? 'failed' : 'passed',
    latencyMs: Math.round(latency * 10) / 10,
    costUsd: Math.round(cost * 1_000_000) / 1_000_000,
    usage: { in: tokensIn, out: tokensOut, model: SEEDED_MODEL, source: 'estimated' },
    scorers,
    response: {
      status: 200,
      body,
      bodyText: JSON.stringify(body),
    },
  };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
