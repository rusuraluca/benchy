import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/storage/store';
import { seedDemoRuns } from '../src/storage/seed';
import { buildSummary } from '../src/core/runner';
import type { CaseOutcome, CaseSpec } from '../src/core/types';

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

describe('Store', () => {
  it('persists runs and their results', () => {
    const dir = mkdtempSync(join(tmpdir(), 'benchy-store-'));
    const store = new Store(dir);
    const outcomes = [outcomeFor('a', 'passed', 10), outcomeFor('b', 'failed', 13)];
    const summary = buildSummary(outcomes, 42);
    const id = store.createRun({
      label: 'v1',
      config: { name: 'x' },
      outcomes,
      summary,
      status: 'failed',
    });

    expect(store.countRuns()).toBe(1);
    const run = store.getRun(id)!;
    expect(run.label).toBe('v1');
    expect(run.summary.passed).toBe(1);
    expect(run.summary.failed).toBe(1);
    expect(run.summary.durationMs).toBe(42);
    expect(run.summary.avgLatencyMs).toBeCloseTo(11.5, 0);
    expect(run.status).toBe('failed');

    const results = store.getResults(id);
    expect(results).toHaveLength(2);
    expect(results[0]!.caseId).toBe('a');
    expect(results[1]!.status).toBe('failed');
    expect(results[1]!.detail).toContain('expected');

    expect(store.findRun('unknown')).toBeUndefined();
    expect(store.findRun(id)?.id).toBe(id);
    expect(store.findRun('v1')?.id).toBe(id);
    store.close();
  });

  it('deletes runs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'benchy-store-'));
    const store = new Store(dir);
    const summary = buildSummary([], 0);
    const id = store.createRun({ label: 'x', config: {}, outcomes: [], summary, status: 'passed' });
    expect(store.deleteRun(id)).toBe(true);
    expect(store.countRuns()).toBe(0);
    expect(store.deleteRun(id)).toBe(false);
    store.close();
  });
});

describe('seedDemoRuns', () => {
  it('seeds the v1.0 → v1.3 regression story', () => {
    const dir = mkdtempSync(join(tmpdir(), 'benchy-seed-'));
    const store = new Store(dir);
    expect(seedDemoRuns(store, false)).toBe(5);
    const runs = store.listRuns(10).reverse();
    expect(runs.map((r) => r.label)).toEqual(['v1.0', 'v1.1', 'v1.2', 'v1.3', 'v1.4 (rollback)']);

    const before = runs.find((r) => r.label === 'v1.0');
    const broken = runs.find((r) => r.label === 'v1.3')!;
    expect(before!.status).toBe('passed');
    expect(broken.status).toBe('failed');
    expect(broken.summary.failed).toBe(2);
    expect(broken.summary.passRate).toBeLessThan(1);
    store.close();
  });

  it('respects onlyIfEmpty', () => {
    const dir = mkdtempSync(join(tmpdir(), 'benchy-seed-'));
    const store = new Store(dir);
    expect(seedDemoRuns(store, true)).toBe(5);
    expect(seedDemoRuns(store, true)).toBe(0);
    store.close();
  });
});
