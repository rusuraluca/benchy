import { describe, expect, it } from 'vitest';
import { evaluateExact } from '../src/scorers/exact';
import { evaluateSchema } from '../src/scorers/schema';
import { judgeOutput, resolveJudgeEngine } from '../src/scorers/judge';
import type { BenchConfig } from '../src/core/types';

describe('exact scorer', () => {
  it('passes on deep matches', () => {
    expect(evaluateExact({ a: [1, 2] }, { a: [1, 2] })).toEqual({
      passed: true,
      detail: 'output matches expected',
    });
  });

  it('fails with a diff path', () => {
    const result = evaluateExact({ a: 1 }, { a: 2 });
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('$.a');
  });
});

describe('schema scorer', () => {
  const schema = {
    type: 'object',
    required: ['name'],
    properties: { name: { type: 'string' }, age: { type: 'number' } },
  };

  it('validates conforming values', () => {
    expect(evaluateSchema(schema, { name: 'x', age: 3 }).passed).toBe(true);
  });

  it('reports readable errors', () => {
    const result = evaluateSchema(schema, { age: 'nope' });
    expect(result.passed).toBe(false);
    expect(result.errors.join(' ')).toContain('name');
  });

  it('throws on invalid schema definitions', () => {
    expect(() => evaluateSchema({ type: 42 }, {})).toThrow();
  });
});

describe('judge scorer', () => {
  const config: BenchConfig = {
    name: 't',
    target: { url: 'http://x' },
    judge: { model: 'gpt-4o-mini' },
  };

  it('resolves the engine with defaults for openai', () => {
    const engine = resolveJudgeEngine({ ...config, judge: { model: 'custom' } });
    expect(engine?.model).toBe('custom');
    expect(engine?.baseUrl).toBe('https://api.openai.com/v1');
    expect(engine?.temperature).toBe(0);
  });

  it('resolves no engine when judge is unconfigured', () => {
    expect(resolveJudgeEngine({ name: 't', target: { url: 'http://x' } })).toBeUndefined();
  });

  it('skips when no API key is present', async () => {
    const engine = resolveJudgeEngine(config)!;
    const result = await judgeOutput(engine, { criteria: 'be good', required: false }, {}, {});
    expect(result.status).toBe('skipped');
  });

  it('returns an error status on failing judge requests', async () => {
    const engine = { model: 'm', baseUrl: 'http://127.0.0.1:1', apiKey: 'k', temperature: 0 };
    const result = await judgeOutput(engine, { criteria: 'x' }, {}, {});
    expect(result.status).toBe('error');
  });
});
