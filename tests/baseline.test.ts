import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeBaseline, checkBaseline, readBaseline } from '../src/core/baseline';
import { compareRuns } from '../src/core/comparison';
import type { CaseOutcome, CaseSpec, ResultRow, RunRecord } from '../src/core/types';

function outcomeFor(id: string, status: CaseOutcome['status'], latencyMs = 10): CaseOutcome {
  const spec: CaseSpec = { id, name: id, expected: { output: { ok: true } } };
  return {
    index: 0,
    spec,
    status,
    latencyMs,
    costUsd: 0,
    usage: { source: 'none' },
    scorers: [{ name: 'exact', status, detail: status === 'passed' ? 'ok' : 'different' }],
  };
}

function runRow(label: string, passRate = 1): RunRecord {
  return {
    id: `${label}-id`,
    label,
    startedAt: '',
    finishedAt: '',
    status: 'passed',
    config: {},
    summary: {
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      errored: 0,
      passRate,
      avgLatencyMs: 0,
      p50LatencyMs: 0,
      p95LatencyMs: 0,
      totalCostUsd: 0,
      tokensIn: 0,
      tokensOut: 0,
      durationMs: 0,
    },
  };
}

function resultRow(idx: number, caseId: string, status: string, latencyMs: number): ResultRow {
  return {
    id: idx,
    runId: 'run',
    caseIndex: idx,
    caseId,
    title: caseId,
    tags: '[]',
    status: status as ResultRow['status'],
    latencyMs,
    costUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
    scorers: '[]',
    detail: '{}',
    createdAt: '',
  };
}

describe('baseline', () => {
  it('writes a baseline file that round-trips', () => {
    const dir = mkdtempSync(join(tmpdir(), 'benchy-baseline-'));
    const file = join(dir, 'baseline.json');
    const baseline = writeBaseline(file, 'v1.2', [
      outcomeFor('a', 'passed', 9),
      outcomeFor('b', 'passed', 12),
    ]);
    expect(baseline.summary.total).toBe(2);
    expect(baseline.cases.a).toEqual({ status: 'passed', medianLatencyMs: 9 });
    const reread = readBaseline(file)!;
    expect(reread.benchy).toBe(1);
    expect(reread.label).toBe('v1.2');
  });

  it('flags pass→failed and pass→error as regressions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'benchy-baseline-'));
    const file = join(dir, 'baseline.json');
    writeBaseline(file, 'v1', [outcomeFor('a', 'passed'), outcomeFor('b', 'passed')]);

    const regressed = checkBaseline(file, [outcomeFor('a', 'passed'), outcomeFor('b', 'failed')]);
    expect(regressed.regressions.map((r) => r.caseId)).toEqual(['b']);
    expect(regressed.regressions[0]!.before).toBe('passed');
    expect(regressed.regressions[0]!.after).toBe('failed');
    expect(regressed.passRateOk).toBe(false);

    const errored = checkBaseline(file, [outcomeFor('a', 'passed'), outcomeFor('b', 'error')]);
    expect(errored.regressions).toHaveLength(1);

    const ok = checkBaseline(file, [outcomeFor('a', 'passed'), outcomeFor('b', 'passed')]);
    expect(ok.regressions).toEqual([]);
    expect(ok.passRateOk).toBe(true);
  });

  it('treats new cases as untracked, not regressions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'benchy-baseline-'));
    const file = join(dir, 'baseline.json');
    writeBaseline(file, 'v1', [outcomeFor('a', 'passed')]);
    const result = checkBaseline(file, [outcomeFor('a', 'passed'), outcomeFor('new', 'passed')]);
    expect(result.skippedCases).toEqual(['new']);
    expect(result.regressions).toEqual([]);
  });
});

describe('compareRuns', () => {
  it('classifies regressed, fixed, added and slower cases', () => {
    const aResults = [
      resultRow(0, 'x', 'passed', 10),
      resultRow(1, 'y', 'failed', 10),
      resultRow(2, 'z', 'passed', 10),
    ];
    const bResults = [
      resultRow(0, 'x', 'failed', 11),
      resultRow(1, 'y', 'passed', 9),
      resultRow(2, 'z', 'passed', 40),
      resultRow(3, 'n', 'passed', 5),
    ];
    const comparison = compareRuns(runRow('v1', 0.67), runRow('v2', 1), aResults, bResults);

    const byCase = new Map(comparison.changes.map((c) => [c.caseId, c.kind]));
    expect(byCase.get('x')).toBe('regressed');
    expect(byCase.get('y')).toBe('fixed');
    expect(byCase.get('z')).toBe('latency-regression');
    expect(byCase.get('n')).toBe('added');
  });
});
