import { createServer } from 'node:http';
import type { ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Store } from '../storage/store';
import { compareRuns } from '../core/comparison';

export interface DashboardServerOptions {
  suiteName?: string;
}

function frontendDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '..', 'frontend'),
    join(here, '..', '..', 'dist', 'frontend'),
    join(here, 'frontend'),
  ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'index.html'))) return normalize(candidate);
  }
  return join(here, '..', 'frontend');
}

export function createDashboardServer(store: Store, options: DashboardServerOptions = {}) {
  const frontend = frontendDir();

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = url.pathname;

    if (pathname === '/api/health') {
      respondJson(res, { ok: true });
      return;
    }

    if (pathname === '/api/overview') {
      const runs = store.listRuns(100);
      respondJson(res, {
        suiteName: options.suiteName ?? runs[0]?.config?.name ?? 'benchy',
        runs,
        series: buildSeries(runs),
      });
      return;
    }

    const runMatch = pathname.match(/^\/api\/runs\/([0-9a-f-]+)$/);
    if (runMatch) {
      const run = store.getRun(runMatch[1]!);
      if (!run) {
        respondJson(res, { error: 'run not found' }, 404);
        return;
      }
      respondJson(res, { run, results: store.getResults(run.id) });
      return;
    }

    if (pathname === '/api/compare') {
      const refB = url.searchParams.get('to') ?? url.searchParams.get('b');
      const refA = url.searchParams.get('from') ?? url.searchParams.get('a');
      const b = refB ? store.findRun(refB) : store.listRuns(1)[0];
      const a = refA ? store.findRun(refA) : store.listRuns(2)[1];
      if (!a || !b) {
        respondJson(res, { error: 'need two runs to compare' }, 400);
        return;
      }
      respondJson(res, {
        comparison: compareRuns(a, b, store.getResults(a.id), store.getResults(b.id)),
      });
      return;
    }

    if (pathname === '/api/refs') {
      const runs = store.listRuns(100);
      respondJson(res, { runs });
      return;
    }

    if (pathname === '/' || pathname === '/index.html') {
      serveFile(res, join(frontend, 'index.html'));
      return;
    }

    if (pathname === '/app.css' || pathname === '/app.js') {
      const file = join(frontend, pathname.slice(1));
      if (!file.startsWith(frontend)) {
        respondJson(res, { error: 'forbidden' }, 403);
        return;
      }
      serveFile(res, file);
      return;
    }

    respondJson(res, { error: 'not found' }, 404);
  });

  return {
    listen(port: number): Promise<string> {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, () => {
          const address = server.address();
          const host =
            typeof address === 'object' && address
              ? `http://localhost:${address.port}`
              : `http://localhost:${port}`;
          resolve(host);
        });
      });
    },
    close(): Promise<void> {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

function buildSeries(runs: ReturnType<Store['listRuns']>) {
  const ordered = [...runs].reverse();
  return {
    passRate: ordered.map((r) => ({ label: r.label, value: Math.round(r.summary.passRate * 100) })),
    latencyP50: ordered.map((r) => ({ label: r.label, value: r.summary.p50LatencyMs })),
    costUsd: ordered.map((r) => ({ label: r.label, value: r.summary.totalCostUsd })),
    durationSec: ordered.map((r) => ({
      label: r.label,
      value: Math.round(r.summary.durationMs / 1000),
    })),
  };
}

function respondJson(res: ServerResponse, payload: unknown, status = 200): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

function serveFile(res: ServerResponse, file: string): void {
  try {
    const body = readFileSync(file);
    const ext = file.split('.').pop();
    const type =
      ext === 'html'
        ? 'text/html; charset=utf-8'
        : ext === 'css'
          ? 'text/css; charset=utf-8'
          : 'application/javascript; charset=utf-8';
    res.writeHead(200, {
      'content-type': type,
      'content-length': body.length,
      'cache-control': ext === 'html' ? 'no-cache' : 'public, max-age=3600',
    });
    res.end(body);
  } catch {
    respondJson(res, { error: 'not found' }, 404);
  }
}
