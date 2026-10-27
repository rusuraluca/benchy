import type { BenchConfig, CaseOutcome, CaseSpec, RunSummary, Usage } from './types';
import { isPlainObject } from './deepequal';
import { callTarget } from './target';
import { runScorers } from '../scorers';

export interface RunnerOptions {
  label?: string;
  tag?: string;
  name?: string;
  targetUrl?: string;
  concurrency?: number;
  timeoutMs?: number;
  retries?: number;
}

export interface RunnerResult {
  outcomes: CaseOutcome[];
  summary: RunSummary;
}

const DEFAULT_CONCURRENCY = 16;

export async function runSuite(
  config: BenchConfig,
  cases: CaseSpec[],
  options: RunnerOptions = {},
): Promise<RunnerResult> {
  const targetUrl = (options.targetUrl ?? config.target.url).replace(/\/+$/, '');
  const concurrency = Math.min(options.concurrency ?? config.concurrency ?? 3, DEFAULT_CONCURRENCY);
  const startedAt = Date.now();

  let filtered = cases;
  if (options.tag) {
    filtered = filtered.filter((c) => c.tags?.includes(options.tag as string));
  }
  if (options.name) {
    const needle = (options.name as string).toLowerCase();
    filtered = filtered.filter(
      (c) => c.id.toLowerCase().includes(needle) || (c.name ?? '').toLowerCase().includes(needle),
    );
  }

  const queue = [...filtered];
  const outcomes: CaseOutcome[] = [];
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = nextIndex++;
      const spec = queue[index];
      if (!spec) return;
      const outcome = await executeCase(config, spec, index, targetUrl, options);
      outcomes.push(outcome);
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, () => worker());
  await Promise.all(workers);
  outcomes.sort((a, b) => a.index - b.index);

  return { outcomes, summary: buildSummary(outcomes, Date.now() - startedAt) };
}

async function executeCase(
  config: BenchConfig,
  spec: CaseSpec,
  index: number,
  targetUrl: string,
  options: RunnerOptions,
): Promise<CaseOutcome> {
  const timeoutMs = options.timeoutMs ?? spec.timeoutMs ?? config.timeoutMs ?? 30_000;
  const retries = options.retries ?? spec.retries ?? config.retries ?? 0;

  try {
    const response = await callTarget({
      baseUrl: targetUrl,
      method: spec.method ?? 'POST',
      path: spec.path,
      headers: spec.headers,
      body: spec.input,
      timeoutMs,
      retries,
    });

    const scorers = await runScorers(config, spec, response);

    let usage: Usage | undefined = extractUsage(response.body);
    const judgeUsage = scorers.find((s) => s.name === 'judge')?.usage;
    if (usage?.source === 'none' || usage === undefined) {
      usage = judgeUsage;
    }
    if (!usage) {
      usage = estimateUsage(config, spec, response);
    }

    return {
      index,
      spec,
      status: deriveCaseStatus(scorers),
      latencyMs: response.latencyMs,
      costUsd: computeCost(config, usage),
      usage,
      scorers,
      response: {
        status: response.status,
        body: response.body,
        bodyText: response.bodyText,
      },
    };
  } catch (err) {
    return {
      index,
      spec,
      status: 'error',
      latencyMs: 0,
      costUsd: 0,
      usage: { source: 'none' },
      scorers: [],
      error: (err as Error).message,
    };
  }
}

function deriveCaseStatus(scorers: CaseOutcome['scorers']): CaseOutcome['status'] {
  if (scorers.length === 0) return 'skipped';
  if (scorers.some((s) => s.status === 'error')) return 'error';
  if (scorers.some((s) => s.status === 'failed')) return 'failed';
  if (scorers.every((s) => s.status === 'skipped')) return 'skipped';
  return 'passed';
}

export function extractUsage(payload: unknown): Usage | undefined {
  if (!isPlainObject(payload)) return undefined;
  const usage = payload.usage;
  if (!isPlainObject(usage)) {
    return extractGoogleUsage(payload);
  }

  let inTokens: unknown = usage.prompt_tokens;
  let outTokens: unknown = usage.completion_tokens;
  if (inTokens === undefined && isPlainObject(usage.tokens)) {
    inTokens = usage.tokens.input;
    outTokens = usage.tokens.output;
  }
  const safeIn: number | undefined =
    typeof inTokens === 'number' && Number.isFinite(inTokens) ? inTokens : undefined;
  const safeOut: number | undefined =
    typeof outTokens === 'number' && Number.isFinite(outTokens) ? outTokens : undefined;
  if (safeIn === undefined && safeOut === undefined) return undefined;

  const model = usage.model;
  return {
    in: safeIn,
    out: safeOut,
    model: typeof model === 'string' ? model : undefined,
    source: 'app',
  };
}

function extractGoogleUsage(payload: Record<string, unknown>): Usage | undefined {
  const metadata = payload.usageMetadata;
  if (!isPlainObject(metadata)) return undefined;
  const inTokens = metadata.promptTokenCount;
  const outTokens = metadata.candidatesTokenCount;
  const safeIn: number | undefined =
    typeof inTokens === 'number' && Number.isFinite(inTokens) ? inTokens : undefined;
  const safeOut: number | undefined =
    typeof outTokens === 'number' && Number.isFinite(outTokens) ? outTokens : undefined;
  if (safeIn === undefined && safeOut === undefined) return undefined;
  const model =
    typeof payload.model === 'string'
      ? payload.model
      : typeof payload.modelVersion === 'string' && payload.modelVersion.length > 0
        ? payload.modelVersion
        : isPlainObject(payload.modelMetadata) && typeof payload.modelMetadata.model === 'string'
          ? payload.modelMetadata.model
          : undefined;
  return { in: safeIn, out: safeOut, model, source: 'app' };
}

function estimateUsage(
  config: BenchConfig,
  spec: CaseSpec,
  response: { body: unknown; bodyText: string },
): Usage {
  const model = responseModel(config, response.body);
  if (!model) return { source: 'none' };
  const inputTokens = Math.ceil(JSON.stringify(spec.input ?? '').length / 4);
  const outputTokens = Math.ceil(response.bodyText.length / 4);
  return { in: inputTokens, out: outputTokens, model, source: 'estimated' };
}

function responseModel(config: BenchConfig, body: unknown): string | undefined {
  if (isPlainObject(body)) {
    const model = (body as Record<string, unknown>).model;
    if (typeof model === 'string' && model.length > 0) return model;
  }
  return config.target.model;
}

export function computeCost(config: BenchConfig, usage: Usage): number {
  if (usage.in === undefined && usage.out === undefined) return 0;
  const prices = config.pricing;
  if (!prices) return 0;
  const key = usage.model && prices[usage.model] ? usage.model : 'default';
  const model = prices[key];
  if (!model) return 0;
  const inCost = ((usage.in ?? 0) / 1_000_000) * model.input;
  const outCost = ((usage.out ?? 0) / 1_000_000) * model.output;
  return round6(inCost + outCost);
}

export function buildSummary(outcomes: CaseOutcome[], durationMs: number): RunSummary {
  const total = outcomes.length;
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let errored = 0;
  const latencies: number[] = [];
  let totalCostUsd = 0;
  let tokensIn = 0;
  let tokensOut = 0;

  for (const o of outcomes) {
    if (o.status === 'passed') passed++;
    else if (o.status === 'failed') failed++;
    else if (o.status === 'skipped') skipped++;
    else errored++;
    if (o.latencyMs > 0) latencies.push(o.latencyMs);
    totalCostUsd += o.costUsd;
    tokensIn += o.usage.in ?? 0;
    tokensOut += o.usage.out ?? 0;
  }

  return {
    total,
    passed,
    failed,
    skipped,
    errored,
    passRate: total === 0 ? 0 : round4(passed / total),
    avgLatencyMs: avg(latencies),
    p50LatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
    totalCostUsd: round6(totalCostUsd),
    tokensIn,
    tokensOut,
    durationMs,
  };
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return round1(values.reduce((a, b) => a + b, 0) / values.length);
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return round1(sorted[idx]!);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
