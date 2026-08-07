import { describe, expect, it } from 'vitest';
import { parseCliArgs } from '../src/cli/args';
import { paint, formatLatency, formatUsd, formatPercent, truncate } from '../src/cli/render';
import { callTarget } from '../src/core/target';

describe('parseCliArgs', () => {
  it('parses commands, subcommands and flags', () => {
    const parsed = parseCliArgs([
      'baseline',
      'check',
      '--config',
      'examples/demo/benchy.yaml',
      '--target',
      'http://localhost:3001',
      '--json',
      '--allow-fail',
    ]);
    expect(parsed.command).toBe('baseline');
    expect(parsed.subcommand).toBe('check');
    expect(parsed.options.config).toBe('examples/demo/benchy.yaml');
    expect(parsed.options.target).toBe('http://localhost:3001');
    expect(parsed.options.json).toBe(true);
    expect(parsed.options['allow-fail']).toBe(true);
  });

  it('collects positional refs for diff', () => {
    const parsed = parseCliArgs(['diff', 'v1.2', 'v1.3']);
    expect(parsed.rest).toEqual(['v1.2', 'v1.3']);
  });

  it('supports short aliases', () => {
    const parsed = parseCliArgs(['run', '-c', 'x.yaml', '-t', 'u', '-l', 'v1']);
    expect(parsed.options.config).toBe('x.yaml');
    expect(parsed.options.target).toBe('u');
    expect(parsed.options.label).toBe('v1');
  });

  it('parses boolean flags used by serve and diff', () => {
    const parsed = parseCliArgs(['serve', '--demo', '--port', '4173']);
    expect(parsed.options.demo).toBe(true);

    const diff = parseCliArgs(['diff', 'a', 'b', '--fail-on-regression']);
    expect(diff.options['fail-on-regression']).toBe(true);
  });
});

describe('render helpers', () => {
  it('formats latency, cost and percentages', () => {
    expect(formatLatency(1500)).toBe('1.50s');
    expect(formatLatency(250)).toBe('250ms');
    expect(formatLatency(0)).toBe('-');
    expect(formatUsd(0)).toBe('$0');
    expect(formatUsd(0.0000123)).toMatch(/^\$\d/);
    expect(formatPercent(0.9123)).toBe('91%');
  });

  it('paints statuses and truncates long text', () => {
    expect(paint('passed')).toContain('passed');
    expect(truncate('a'.repeat(300), 120).length).toBe(120);
  });
});

describe('callTarget', () => {
  it('fails cleanly for unreachable hosts', async () => {
    await expect(
      callTarget({ baseUrl: 'http://127.0.0.1:1', method: 'POST', timeoutMs: 500, retries: 0 }),
    ).rejects.toThrow(/request to/);
  });
});
