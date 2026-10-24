import { readFileSync, writeFileSync } from 'node:fs';
import { isPlainObject } from './deepequal';
import { buildSummary } from './runner';
import type {
  BaselineCase,
  BaselineCheckResult,
  BaselineFile,
  CaseOutcome,
  CaseStatus,
} from './types';

export function writeBaseline(
  file: string,
  label: string,
  outcomes: CaseOutcome[],
  targetPassRate = 1,
): BaselineFile {
  const byId = new Map<string, CaseOutcome>();
  for (const o of outcomes) {
    const current = byId.get(o.spec.id);
    if (!current || o.latencyMs < current.latencyMs) {
      byId.set(o.spec.id, o);
    }
  }

  const summary = buildSummary(outcomes, 0);
  const cases: Record<string, BaselineCase> = {};
  for (const [id, o] of byId) {
    cases[id] = {
      status: o.status,
      medianLatencyMs: o.latencyMs,
    };
  }

  const baseline: BaselineFile = {
    benchy: 1,
    updatedAt: new Date().toISOString(),
    label,
    targetPassRate,
    summary: {
      total: summary.total,
      passRate: summary.passRate,
      p50LatencyMs: summary.p50LatencyMs,
      totalCostUsd: summary.totalCostUsd,
    },
    cases,
  };
  writeFileSync(file, `${JSON.stringify(baseline, null, 2)}\n`);
  return baseline;
}

export function readBaseline(file: string): BaselineFile | undefined {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    if (!isPlainObject(parsed) || parsed.benchy !== 1) return undefined;
    return parsed as unknown as BaselineFile;
  } catch {
    return undefined;
  }
}

export function checkBaseline(
  file: string,
  outcomes: CaseOutcome[],
  targetPassRate = -1,
): BaselineCheckResult {
  const baselineFile = readBaseline(file) ?? baselineWithout(file);
  const regressions: BaselineCheckResult['regressions'] = [];
  const skippedCases: string[] = [];

  for (const o of outcomes) {
    const before = baselineFile.cases[o.spec.id]?.status;
    if (before === undefined) {
      skippedCases.push(o.spec.id);
      continue;
    }
    if (isRegression(before, o.status)) {
      regressions.push({
        caseId: o.spec.id,
        title: o.spec.name ?? o.spec.id,
        before,
        after: o.status,
      });
    }
  }

  const summary = buildSummary(outcomes, 0);
  const target = targetPassRate >= 0 ? targetPassRate : baselineFile.targetPassRate;
  const passRateOk = summary.passRate >= (target ?? 1);

  return {
    file,
    summary,
    regressions,
    passRateOk: Number.isNaN(passRateOk) ? false : passRateOk,
    skippedCases,
    baseline: baselineFile,
  };
}

function isRegression(before: CaseStatus, after: CaseStatus): boolean {
  if (before !== 'passed') return false;
  return after === 'failed' || after === 'error';
}

function baselineWithout(file: string): BaselineFile {
  return {
    benchy: 1,
    updatedAt: file,
    label: 'first-check',
    targetPassRate: 1,
    summary: { total: 0, passRate: 0, p50LatencyMs: 0, totalCostUsd: 0 },
    cases: {},
  };
}
