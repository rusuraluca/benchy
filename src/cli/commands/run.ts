import { booleanOption, createContext, loadContextSuite, stringOption } from '../context';
import {
  ANSI,
  color,
  formatLatency,
  formatPercent,
  formatUsd,
  paint,
  renderTable,
} from '../render';
import { runSuite } from '../../core/runner';

export async function runCmd(options: Record<string, unknown>): Promise<number> {
  const ctx = createContext(options);
  const suite = loadContextSuite(ctx, options);

  const { outcomes, summary } = await runSuite(suite.config, suite.cases, {
    label: stringOption(options['label']),
    tag: stringOption(options['tag']),
    name: stringOption(options['name']),
    targetUrl: ctx.targetUrl,
    concurrency: numberOption(options['concurrency']),
  });

  const label = stringOption(options['label']) ?? suite.config.name ?? 'manual';
  const wantJson = booleanOption(options['json']);

  const runId = ctx.store.createRun({
    label,
    config: { ...(suite.config as unknown as Record<string, unknown>) },
    outcomes,
    summary,
    status: summary.failed === 0 && summary.errored === 0 ? 'passed' : 'failed',
  });

  if (wantJson) {
    process.stdout.write(JSON.stringify({ runId, summary, outcomes }, null, 2) + '\n');
  } else {
    const rows = outcomes.map((o) => [
      paint(o.status),
      o.spec.id,
      formatLatency(o.latencyMs),
      formatUsd(o.costUsd),
      o.scorers.map((s) => s.name).join(',') || '-',
      (o.error ?? '').slice(0, 60),
    ]);
    process.stdout.write(
      renderTable(['status', 'case', 'latency', 'cost', 'scorers', 'error'], rows) + '\n',
    );
    process.stdout.write(`\n`);
    process.stdout.write(
      color(
        ANSI.bold,
        `${suite.config.name} — ${label} (${formatPercent(summary.passRate)} pass)\n`,
      ),
    );
    process.stdout.write(
      `  ${summary.passed}/${summary.total} passed  ${summary.failed} failed  ` +
        `${summary.skipped} skipped  ${summary.errored} errored\n`,
    );
    process.stdout.write(
      `  latency p50 ${formatLatency(summary.p50LatencyMs)} / p95 ${formatLatency(summary.p95LatencyMs)}  ` +
        `cost ${formatUsd(summary.totalCostUsd)}  ${(summary.durationMs / 1000).toFixed(1)}s\n`,
    );
    process.stdout.write(color(ANSI.dim, `  run saved: ${runId}  (store ${ctx.dir})\n`));
    process.stdout.write(
      color(ANSI.dim, '  next: benchy serve — benchy diff <v1> <v2> — benchy baseline check\n'),
    );
  }

  return summary.failed + summary.errored > 0 && !booleanOption(options['allow-fail']) ? 1 : 0;
}

function numberOption(option: unknown): number | undefined {
  const n = typeof option === 'number' ? option : Number(option);
  return Number.isFinite(n) ? n : undefined;
}
