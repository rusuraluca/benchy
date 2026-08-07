import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { runSuite, extractUsage, computeCost } from '../src/core/runner';
import type { BenchConfig, CaseSpec } from '../src/core/types';

const config: BenchConfig = {
  name: 'test',
  target: { url: '', model: 'demo-model' },
  concurrency: 2,
  timeoutMs: 5000,
  pricing: { 'demo-model': { input: 0.1, output: 0.2 } },
};

function echoServer(): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        const input = JSON.parse(raw) as { message: string };
        const body = {
          ok: true,
          echo: input.message,
          usage: { prompt_tokens: 10, completion_tokens: 20, model: 'demo-model' },
        };
        res.end(JSON.stringify(body));
      });
    });
    server.listen(0, () => {
      const address = server.address();
      const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
      resolve({ server, url });
    });
  });
}

describe('runSuite', () => {
  let server: Server | undefined;
  let baseUrl = '';

  afterEach(() => {
    server?.close();
    server = undefined;
  });

  it('scores exact matches and records latency, usage and cost', async () => {
    const { server: s, url } = await echoServer();
    server = s;
    baseUrl = url;

    const cases: CaseSpec[] = [
      {
        id: 'ok',
        name: 'passing',
        input: { message: 'hello' },
        expected: { output: { ok: true, echo: 'hello' } },
      },
      {
        id: 'bad',
        input: { message: 'nope' },
        expected: { output: { ok: true, echo: 'other' } },
      },
    ];
    const { outcomes, summary } = await runSuite(
      { ...config, target: { ...config.target, url: baseUrl } },
      cases,
    );

    expect(summary.total).toBe(2);
    expect(summary.passed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(outcomes[0]!.status).toBe('passed');
    expect(outcomes[0]!.latencyMs).toBeGreaterThan(0);
    expect(outcomes[0]!.usage.in).toBe(10);
    expect(outcomes[0]!.costUsd).toBeGreaterThan(0);
    expect(outcomes[0]!.scorers[0]!.status).toBe('passed');
    expect(summary.tokensIn).toBe(20);
  });

  it('handles network failures as errors', async () => {
    const { outcomes, summary } = await runSuite(config, [
      { id: 'net', input: {}, expected: { output: { ok: true } } },
    ]);
    expect(outcomes[0]!.status).toBe('error');
    expect(outcomes[0]!.error).toBeTruthy();
    expect(summary.errored).toBe(1);
    expect(summary.passRate).toBe(0);
  });

  it('supports filtering by tag and name', async () => {
    const { server: s, url } = await echoServer();
    server = s;
    const cases: CaseSpec[] = [
      { id: 'alpha', tags: ['smoke'], input: { message: 'a' }, expected: { output: { ok: true } } },
      {
        id: 'beta',
        tags: ['nightly'],
        input: { message: 'b' },
        expected: { output: { ok: true } },
      },
    ];
    const cfg = { ...config, target: { ...config.target, url } };
    const tagged = await runSuite(cfg, cases, { tag: 'smoke' });
    expect(tagged.summary.total).toBe(1);
    expect(tagged.outcomes[0]!.spec.id).toBe('alpha');
    const named = await runSuite(cfg, cases, { name: 'bet' });
    expect(named.outcomes[0]!.spec.id).toBe('beta');
  });

  it('runs cases with judge scorer when engine configured', async () => {
    const { server: s, url } = await echoServer();
    server = s;
    const cases: CaseSpec[] = [
      {
        id: 'judged',
        input: { message: 'x' },
        expected: {
          judge: { criteria: 'be nice', required: false },
        },
      },
    ];
    const cfg = {
      ...config,
      judge: { model: 'gpt-4o-mini', baseUrl: `http://127.0.0.1:1` },
      target: { ...config.target, url },
    };
    const { outcomes } = await runSuite(cfg, cases);
    expect(outcomes[0]!.scorers[0]!.name).toBe('judge');
    expect(outcomes[0]!.status).toBe('skipped');
  });
});

describe('usage + cost helpers', () => {
  it('extracts OpenAI-shaped usage', () => {
    expect(extractUsage({ usage: { prompt_tokens: 5, completion_tokens: 6, model: 'm' } })).toEqual(
      { in: 5, out: 6, model: 'm', source: 'app' },
    );
    expect(extractUsage({ usage: { tokens: { input: 1, output: 2 } } })).toEqual({
      in: 1,
      out: 2,
      model: undefined,
      source: 'app',
    });
    expect(extractUsage({ nope: true })).toBeUndefined();
    expect(extractUsage('str')).toBeUndefined();
  });

  it('computes cost from pricing', () => {
    const cfg = { ...config, pricing: { m: { input: 1, output: 2 } } };
    expect(computeCost(cfg, { in: 1_000_000, out: 0, model: 'm', source: 'app' })).toBe(1);
    expect(computeCost(cfg, { in: 0, out: 500_000, model: 'm', source: 'app' })).toBe(1);
    expect(computeCost(cfg, { in: 0, out: 0, model: 'm', source: 'app' })).toBe(0);
    expect(computeCost(cfg, { in: 10, out: 10, model: 'unknown', source: 'app' })).toBe(0);
  });
});
