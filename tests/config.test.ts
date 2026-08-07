import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSuite, ConfigError } from '../src/core/config';

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'benchy-config-'));
  const file = join(dir, name);
  writeFileSync(file, content, 'utf8');
  return file;
}

const VALID = `
name: test-suite
target:
  url: http://localhost:3000
  model: demo-model
pricing:
  demo-model:
    input: 0.1
    output: 0.2
concurrency: 2
cases:
  - id: c1
    input: { message: hello }
    expected:
      output: { ok: true }
  - id: c2
    expected:
      schema:
        type: object
        properties:
          ok: { type: boolean }
  - id: c3
    expected:
      judge:
        criteria: be good
        required: false
`;

describe('loadSuite', () => {
  it('parses a valid config with defaults applied', () => {
    const { config, cases } = loadSuite(writeTemp('benchy.yaml', VALID));
    expect(config.name).toBe('test-suite');
    expect(config.target.url).toBe('http://localhost:3000');
    expect(config.concurrency).toBe(2);
    expect(config.retries).toBe(0);
    expect(config.timeoutMs).toBe(30_000);
    expect(config.pricing?.['demo-model']).toEqual({ input: 0.1, output: 0.2 });
    expect(cases).toHaveLength(3);
    expect(cases[0]!.method).toBe('POST');
    expect(cases[0]!.required).toBe(true);
    expect(cases[2]!.expected?.judge).toEqual({ criteria: 'be good', required: false });
  });

  it('parses imported case files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'benchy-import-'));
    writeFileSync(
      join(dir, 'cases.yaml'),
      '- id: imported-case\n  expected:\n    output: { ok: true }\n',
    );
    writeFileSync(
      join(dir, 'benchy.yaml'),
      `name: x\ntarget: { url: http://localhost:1 }\nimports: [cases.yaml]\n`,
    );
    const { cases } = loadSuite(join(dir, 'benchy.yaml'));
    expect(cases.map((c) => c.id)).toEqual(['imported-case']);
  });

  it('rejects duplicate case ids', () => {
    const file = writeTemp(
      'benchy.yaml',
      `name: x
target: { url: http://localhost:1 }
cases:
  - id: dup
    expected: { output: 1 }
  - id: dup
    expected: { output: 2 }
`,
    );
    expect(() => loadSuite(file)).toThrow(/duplicate test case id "dup"/);
  });

  it('rejects a missing target', () => {
    const file = writeTemp('benchy.yaml', `name: x\ncases: []\n`);
    expect(() => loadSuite(file)).toThrow(ConfigError);
    expect(() => loadSuite(file)).toThrow(/target/);
  });

  it('rejects a missing expected block', () => {
    const file = writeTemp(
      'benchy.yaml',
      `name: x
target: { url: http://localhost:1 }
cases:
  - id: no-assert
    input: { a: 1 }
`,
    );
    expect(() => loadSuite(file)).toThrow(/expected/);
  });

  it('rejects invalid pricing', () => {
    const file = writeTemp(
      'benchy.yaml',
      `name: x
target: { url: http://localhost:1 }
pricing:
  m: { input: -1, output: 2 }
cases: []
`,
    );
    expect(() => loadSuite(file)).toThrow(/pricing/);
  });

  it('parses schema strings as JSON or YAML', () => {
    const file = writeTemp(
      'benchy.yaml',
      `name: x
target: { url: http://localhost:1 }
cases:
  - id: s1
    expected:
      schema: '{"type":"object"}'
  - id: s2
    expected:
      schema: 'type: object'
`,
    );
    const { cases } = loadSuite(file);
    expect(cases[0]!.expected?.schema).toEqual({ type: 'object' });
    expect(cases[1]!.expected?.schema).toEqual({ type: 'object' });
  });

  it('fails on malformed YAML with file context', () => {
    const file = writeTemp('benchy.yaml', 'target: [unclosed');
    expect(() => loadSuite(file)).toThrow(/invalid YAML/);
  });
});
