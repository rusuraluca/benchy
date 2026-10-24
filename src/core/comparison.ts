import type { ResultRow, RunRecord } from './types';

export interface CaseChange {
  kind: 'regressed' | 'fixed' | 'added' | 'removed' | 'latency-regression';
  caseId: string;
  title: string;
  before?: { status: string; latencyMs: number };
  after?: { status: string; latencyMs: number };
}

export interface RunComparison {
  a: RunRecord;
  b: RunRecord;
  changes: CaseChange[];
  passRateDelta: number;
  p50Delta: number;
  costDelta: number;
}

export function compareRuns(
  a: RunRecord,
  b: RunRecord,
  aResults: ResultRow[],
  bResults: ResultRow[],
): RunComparison {
  const byCaseA = mapByCase(aResults);
  const byCaseB = mapByCase(bResults);
  const caseIds = new Set([...byCaseA.keys(), ...byCaseB.keys()]);
  const changes: CaseChange[] = [];

  for (const caseId of caseIds) {
    const ra = byCaseA.get(caseId);
    const rb = byCaseB.get(caseId);
    const title = (rb?.title ?? ra?.title ?? caseId).slice(0, 80);
    const before = ra ? { status: ra.status, latencyMs: ra.latencyMs } : undefined;
    const after = rb ? { status: rb.status, latencyMs: rb.latencyMs } : undefined;

    let kind: CaseChange['kind'] | undefined;
    if (!ra) kind = 'added';
    else if (!rb) kind = 'removed';
    else if (ra.status === 'passed' && (rb.status === 'failed' || rb.status === 'error')) {
      kind = 'regressed';
    } else if (ra.status !== 'passed' && rb.status === 'passed') {
      kind = 'fixed';
    } else if (rb.latencyMs > ra.latencyMs * 1.2 + 5) {
      kind = 'latency-regression';
    }
    if (kind) changes.push({ kind, caseId, title, before, after });
  }

  const passRateDelta = b.summary.passRate - a.summary.passRate;
  const p50Delta = b.summary.p50LatencyMs - a.summary.p50LatencyMs;
  const costDelta = b.summary.totalCostUsd - a.summary.totalCostUsd;

  return { a, b, changes, passRateDelta, p50Delta, costDelta };
}

function mapByCase(results: ResultRow[]): Map<string, ResultRow> {
  const map = new Map<string, ResultRow>();
  for (const r of results) map.set(r.caseId, r);
  return map;
}
