export type CaseStatus = 'passed' | 'failed' | 'skipped' | 'error';
export type ScorerName = 'exact' | 'schema' | 'judge';
export type ScorerStatus = 'passed' | 'failed' | 'skipped' | 'error';

export interface JudgeSpec {
  criteria: string;
  scale?: string;
  required?: boolean;
}

export interface ExactSpec {
  output: unknown;
}

export interface CaseSpec {
  id: string;
  name?: string;
  tags?: string[];
  method?: 'GET' | 'POST' | 'PUT';
  path?: string;
  input?: unknown;
  headers?: Record<string, string>;
  expected?: {
    output?: unknown;
    schema?: unknown;
    judge?: JudgeSpec;
  };
  required?: boolean;
  timeoutMs?: number;
  retries?: number;
}

export interface PricingConfig {
  [model: string]: { input: number; output: number };
}

export interface BenchConfig {
  name: string;
  target: {
    url: string;
    model?: string;
  };
  concurrency?: number;
  retries?: number;
  timeoutMs?: number;
  pricing?: PricingConfig;
  judge?: {
    model?: string;
    baseUrl?: string;
    apiKeyEnv?: string;
    temperature?: number;
  };
}

export interface Usage {
  in?: number;
  out?: number;
  model?: string;
  source: 'app' | 'judge' | 'estimated' | 'none';
}

export interface ScorerOutcome {
  name: ScorerName;
  status: ScorerStatus;
  detail: string;
  reason?: string;
  usage?: Usage;
}

export interface CaseOutcome {
  index: number;
  spec: CaseSpec;
  status: CaseStatus;
  latencyMs: number;
  costUsd: number;
  usage: Usage;
  scorers: ScorerOutcome[];
  response?: {
    status: number;
    body: unknown;
    bodyText: string;
  };
  error?: string;
}

export interface RunSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  errored: number;
  passRate: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  totalCostUsd: number;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
}

export interface RunRecord {
  id: string;
  label: string;
  status: 'passed' | 'failed' | 'aborted';
  startedAt: string;
  finishedAt: string;
  config: Record<string, unknown>;
  summary: RunSummary;
}

export interface ResultRow {
  id: number;
  runId: string;
  caseIndex: number;
  caseId: string;
  title: string;
  tags: string;
  status: CaseStatus;
  latencyMs: number;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  scorers: string;
  detail: string;
  createdAt: string;
}

export interface RunFilters {
  label?: string;
  limit?: number;
}

export interface BaselineFile {
  benchy: 1;
  updatedAt: string;
  label: string;
  targetPassRate: number;
  summary: {
    total: number;
    passRate: number;
    p50LatencyMs: number;
    totalCostUsd: number;
  };
  cases: Record<string, BaselineCase>;
}

export interface BaselineCase {
  status: CaseStatus;
  medianLatencyMs: number;
}

export interface BaselineCheckResult {
  file: string;
  summary: RunSummary;
  regressions: Array<{
    caseId: string;
    title: string;
    before: CaseStatus;
    after: CaseStatus;
  }>;
  passRateOk: boolean;
  skippedCases: string[];
  baseline: BaselineFile;
}
