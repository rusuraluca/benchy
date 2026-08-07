import { createContext, loadContextSuite, stringOption } from '../context';
import { runSuite } from '../../core/runner';
import { checkBaseline, writeBaseline } from '../../core/baseline';
import {
  ANSI,
  color,
  formatLatency,
  formatPercent,
  formatUsd,
  paint,
  renderTable,
} from '../render';

export async function baselineCmd(
  subcommand: string | undefined,
  options: Record<string, unknown>,
): Promise<number> {
  if (subcommand !== 'update' && subcommand !== 'check') {
    process.stdout.write(
      'usage: benchy baseline <update|check> [--baseline file.json] [--config benchy.yaml] ' +
        '[--target url] [--label x] [--dir .benchy]\n',
    );
    return 1;
  }

  const ctx = createContext(options);
  const suite = loadContextSuite(ctx, options);
  const baselineFile =
    stringOption(options['baseline'] ?? options['file']) ?? 'benchy-baseline.json';

  const { outcomes } = await runSuite(suite.config, suite.cases, {
    label: stringOption(options['label']),
    targetUrl: ctx.targetUrl,
    concurrency: numberOption(options['concurrency']),
  });

  if (subcommand === 'update') {
    const label = stringOption(options['label']) ?? 'manual';
    const baseline = writeBaseline(baselineFile, label, outcomes);
    process.stdout.write(
      `baseline written to ${baselineFile}: ${baseline.summary.total} cases, ` +
        `${formatPercent(baseline.summary.passRate)} pass, ` +
        `p50 ${formatLatency(baseline.summary.p50LatencyMs)}\n`,
    );
    return 0;
  }

  const check = checkBaseline(baselineFile, outcomes);

  if (check.regressions.length > 0) {
    const rows = check.regressions.map((r) => [
      paint(r.after),
      r.caseId,
      r.title,
      `${r.before} → ${r.after}`,
    ]);
    process.stdout.write(renderTable(['status', 'case', 'title', 'change'], rows) + '\n');
  }

  process.stdout.write(
    `${formatPercent(check.summary.passRate)} pass (target ` +
      `${formatPercent(check.baseline.targetPassRate)}), ` +
      `${check.regressions.length} regression(s), ${check.summary.failed} failed, ` +
      `${check.summary.errored} errored, ${check.summary.skipped} skipped\n`,
  );
  process.stdout.write(
    `latency p50 ${formatLatency(check.summary.p50LatencyMs)} | p95 ` +
      `${formatLatency(check.summary.p95LatencyMs)}  cost ${formatUsd(check.summary.totalCostUsd)}\n`,
  );
  if (check.skippedCases.length > 0) {
    process.stdout.write(
      color(
        ANSI.yellow,
        `new cases not tracked by baseline yet: ${check.skippedCases.join(', ')}\n`,
      ),
    );
  }

  const ok = check.regressions.length === 0 && check.passRateOk;
  if (ok) {
    process.stdout.write(color(ANSI.green, 'baseline check passed\n'));
  } else {
    if (check.regressions.length > 0) {
      process.stdout.write(
        color(ANSI.red, `baseline check failed: ${check.regressions.length} regression(s)\n`),
      );
    }
    if (!check.passRateOk) {
      process.stdout.write(color(ANSI.red, 'baseline check failed: pass rate below target\n'));
    }
  }

  return ok ? 0 : 1;
}

function numberOption(option: unknown): number | undefined {
  const n = typeof option === 'number' ? option : Number(option);
  return Number.isFinite(n) ? n : undefined;
}
