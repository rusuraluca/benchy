import { createContext } from '../context';
import {
  ANSI,
  color,
  formatLatency,
  formatPercent,
  formatUsd,
  paint,
  renderTable,
  truncate,
  prettyJson,
} from '../render';
import type { ResultRow } from '../../core/types';

export async function listCmd(options: Record<string, unknown>): Promise<number> {
  const ctx = createContext(options);
  const limit = numberOption(options['limit']) ?? 20;
  const runs = ctx.store.listRuns(limit);

  if (runs.length === 0) {
    process.stdout.write('no runs yet — run "benchy run" first\n');
    return 0;
  }

  const rows = runs.map((r) => [
    r.id.slice(0, 8),
    r.label,
    new Date(r.startedAt).toISOString().slice(0, 16).replace('T', ' '),
    paint(r.status),
    formatPercent(r.summary.passRate),
    formatLatency(r.summary.p50LatencyMs),
    formatUsd(r.summary.totalCostUsd),
  ]);
  process.stdout.write(
    renderTable(['id', 'label', 'started', 'status', 'pass', 'p50', 'cost'], rows) + '\n',
  );
  process.stdout.write(color(ANSI.dim, `\n${runs.length} runs (store ${ctx.dir})\n`));
  return 0;
}

export async function showCmd(
  ref: string | undefined,
  options: Record<string, unknown>,
): Promise<number> {
  const ctx = createContext(options);
  const run = ref ? ctx.store.findRun(ref) : ctx.store.listRuns(1)[0];
  if (!run) {
    process.stdout.write(`run not found: ${ref ?? 'no runs yet'}\n`);
    return 1;
  }
  const results = ctx.store.getResults(run.id);

  process.stdout.write(`${color(ANSI.bold, `${run.label} (${paint(run.status)})`)}  ${run.id}\n`);
  process.stdout.write(
    `started ${run.startedAt.slice(0, 19).replace('T', ' ')}  ` +
      `${formatPercent(run.summary.passRate)} pass  ` +
      `latency p50 ${formatLatency(run.summary.p50LatencyMs)} / p95 ` +
      `${formatLatency(run.summary.p95LatencyMs)}  cost ${formatUsd(run.summary.totalCostUsd)}\n\n`,
  );

  const rows = results.map((row) => [
    paint(row.status),
    row.caseId,
    formatLatency(row.latencyMs),
    formatUsd(row.costUsd),
    scorerNames(row).join(','),
  ]);
  process.stdout.write(renderTable(['status', 'case', 'latency', 'cost', 'scorers'], rows) + '\n');

  const failed = results.filter((r) => r.status !== 'passed');
  for (const row of failed.slice(0, 10)) {
    process.stdout.write(`\n${color(ANSI.bold, row.caseId)} ${paint(row.status)}\n`);
    for (const scorer of JSON.parse(row.scorers) as Array<{ name: string; detail: string }>) {
      process.stdout.write(`  ${scorer.name}: ${truncate(scorer.detail, 160)}\n`);
    }
    const detail = JSON.parse(row.detail) as {
      error?: string;
      response?: { status?: number; body?: unknown };
    };
    if (detail.error) process.stdout.write(`  error: ${truncate(detail.error, 200)}\n`);
    if (detail.response && detail.response.body !== undefined) {
      process.stdout.write(`  got: ${truncate(prettyJson(detail.response.body), 240)}\n`);
    }
  }

  if (options['json']) {
    process.stdout.write(JSON.stringify({ run, results }, null, 2) + '\n');
  }
  return 0;
}

export function scorerNames(row: ResultRow): string[] {
  return (JSON.parse(row.scorers) as Array<{ name: string }>).map((s) => s.name);
}

function numberOption(option: unknown): number | undefined {
  const n = typeof option === 'number' ? option : Number(option);
  return Number.isFinite(n) ? n : undefined;
}
