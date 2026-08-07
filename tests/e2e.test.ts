import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCmd } from '../src/cli/commands/run';
import { diffCmd } from '../src/cli/commands/diff';
import { baselineCmd } from '../src/cli/commands/baseline';
import { initCmd } from '../src/cli/commands/init';
import { listCmd, showCmd } from '../src/cli/commands/query';
import { serveCmd } from '../src/cli/commands/serve';
import { Store } from '../src/storage/store';
import { seedDemoRuns } from '../src/storage/seed';
import { createDashboardServer } from '../src/dashboard/server';

function mockTriageServer(): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.url === '/healthz') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: true, mode: 'v1' }));
        return;
      }
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const body = JSON.parse(raw);
        res.setHeader('content-type', 'application/json');
        const category = body.message?.includes('refund') ? 'billing' : 'bug';
        res.end(
          JSON.stringify({
            category,
            priority: 'medium',
            sentiment: 'negative',
            summary: `Ticket about ${category}`,
            usage: { prompt_tokens: 20, completion_tokens: 30, model: 'rule-triage-v1' },
          }),
        );
      });
    });
    server.listen(0, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

const SUITE = `
name: e2e-suite
target:
  url: http://127.0.0.1:1
  model: rule-triage-v1
pricing:
  rule-triage-v1: { input: 0.1, output: 0.1 }
cases:
  - id: refund-ok
    input: { message: "I want a refund please" }
    expected:
      output: { category: billing }
  - id: outage
    input: { message: "everything is down right now" }
    expected:
      output: { category: bug, priority: medium }
  - id: crashes
    input: { message: "the app crashes on startup" }
    expected:
      output: { category: bug, priority: medium }
`;

const REGRESSED_SUITE = SUITE.replace(
  'output: { category: billing }',
  'output: { category: feature }',
);

const FAILED_SUITE = SUITE.replace(
  'output: { category: bug, priority: medium }',
  'output: { category: feature, priority: high }',
);

function writeSuite(cwd: string, contents = SUITE): string {
  const config = join(cwd, 'benchy.yaml');
  writeFileSync(config, contents, 'utf8');
  return config;
}

function captureStdout(): string[] {
  const lines: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    lines.push(String(chunk));
    return true;
  });
  return lines;
}

describe.sequential('CLI end-to-end', () => {
  let cwd: string;
  let server: Server | undefined;
  let target: string;

  beforeEach(async () => {
    cwd = mkdtempSync(join(tmpdir(), 'benchy-e2e-'));
    const setup = await mockTriageServer();
    server = setup.server;
    target = setup.url;
  });

  afterEach(() => {
    server?.close();
    server = undefined;
    vi.restoreAllMocks();
  });

  it('init writes benchy.yaml', () => {
    const initDir = mkdtempSync(join(tmpdir(), 'benchy-init-'));
    const initOut = captureStdout();
    const code = initCmd(initDir, {});
    expect(code).toBe(0);
    expect(existsSync(join(initDir, 'benchy.yaml'))).toBe(true);
    expect(initOut.join('')).toContain('created');
  });

  it('run: exit 0 when every case passes', async () => {
    const config = writeSuite(cwd);
    const lines = captureStdout();
    const code = await runCmd({ config, dir: join(cwd, '.benchy'), target, label: 'v1.0' });
    expect(code).toBe(0);
    expect(lines.join('')).toContain('v1.0');
    expect(lines.join('')).toContain('3/3');
  });

  it('run: exit 1 when a case fails', async () => {
    const config = writeSuite(cwd, FAILED_SUITE);
    const lines = captureStdout();
    const code = await runCmd({ config, dir: join(cwd, '.benchy'), target, label: 'v0.9' });
    expect(code).toBe(1);
    expect(lines.join('')).toContain('failed');
  });

  it('run: exit 0 with --allow-fail even when a case fails', async () => {
    const config = writeSuite(cwd, FAILED_SUITE);
    const code = await runCmd({
      config,
      dir: join(cwd, '.benchy'),
      target,
      label: 'v0.8',
      'allow-fail': true,
    });
    expect(code).toBe(0);
  });

  it('diff: reports a regression and fails with --fail-on-regression', async () => {
    const dir = join(cwd, '.benchy');
    const good = writeSuite(cwd);
    await runCmd({ config: good, dir, target, label: 'good' });
    const bad = writeSuite(cwd, REGRESSED_SUITE);
    await runCmd({ config: bad, dir, target, label: 'bad', 'allow-fail': true });

    const lines = captureStdout();
    const code = await diffCmd('good', 'bad', { dir, 'fail-on-regression': true });
    expect(code).toBe(1);
    expect(lines.join('')).toContain('regression');
  });

  it('baseline update then check blocks a regression', async () => {
    const dir = join(cwd, '.benchy');
    const config = writeSuite(cwd);
    const baseline = join(cwd, 'baseline.json');

    await baselineCmd('update', { config, dir, target, baseline, label: 'v1' });
    expect(existsSync(baseline)).toBe(true);

    writeSuite(cwd, REGRESSED_SUITE);
    const lines = captureStdout();
    const code = await baselineCmd('check', { config, dir, target, baseline });
    expect(code).toBe(1);
    expect(lines.join('')).toContain('regression');
  });

  it('list and show render stored runs', async () => {
    const dir = join(cwd, '.benchy');
    const store = new Store(dir);
    seedDemoRuns(store, false);
    store.close();

    const out1 = captureStdout();
    const code1 = await listCmd({ dir });
    expect(code1).toBe(0);
    expect(out1.join('')).toContain('v1.0');

    const out2 = captureStdout();
    const code2 = await showCmd(undefined, { dir });
    expect(code2).toBe(0);
    expect(out2.join('')).toContain('triage');
  });

  it('serve seeds demo runs and starts the server', async () => {
    const dir = join(cwd, '.benchy-serve');
    const lines = captureStdout();
    const pid = await serveCmd({ dir, port: 0, demo: true });
    expect(pid).toBe(0);
    expect(lines.join('')).toContain('seeded');
  });
});

describe('dashboard server', () => {
  let store: Store;
  let server: ReturnType<typeof createDashboardServer>;
  let host = '';

  beforeEach(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'benchy-dash-'));
    store = new Store(dir);
    seedDemoRuns(store, false);
    server = createDashboardServer(store, { suiteName: 'support-triage-demo' });
    host = await server.listen(0);
  });

  afterEach(async () => {
    await server.close();
    store.close();
  });

  it('serves the overview API and the app shell', async () => {
    const overview = (await fetch(`${host}/api/overview`).then((r) => r.json())) as {
      runs: Array<{ id: string }>;
      series: { passRate: number[] };
    };
    expect(overview.runs.length).toBe(5);
    expect(overview.series.passRate.length).toBe(5);

    const runId = overview.runs[0]!.id;
    const detail = (await fetch(`${host}/api/runs/${runId}`).then((r) => r.json())) as {
      results: unknown[];
    };
    expect(detail.results.length).toBeGreaterThan(0);

    const html = await fetch(`${host}/`).then((r) => r.text());
    expect(html).toContain('benchy');
    const css = await fetch(`${host}/app.css`).then((r) => r.text());
    expect(css).toContain('--bg');
  });

  it('compares two runs', async () => {
    const runs = store.listRuns(5);
    const [a, b] = [runs[1]!, runs[0]!];
    const data = (await fetch(`${host}/api/compare?from=${a.id}&to=${b.id}`).then((r) =>
      r.json(),
    )) as { comparison: { a: { label: string }; b: { label: string } } };
    expect(data.comparison.a.label).toBe(a.label);
    expect(data.comparison.b.label).toBe(b.label);
  });

  it('404s unknown runs', async () => {
    const res = await fetch(`${host}/api/runs/00000000-0000-0000-0000-000000000000`);
    expect(res.status).toBe(404);
  });

  it('serves a health endpoint', async () => {
    const health = (await fetch(`${host}/api/health`).then((r) => r.json())) as { ok: boolean };
    expect(health.ok).toBe(true);
  });
});
