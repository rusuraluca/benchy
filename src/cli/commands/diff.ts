import { createContext, booleanOption } from '../context';
import {
  ANSI,
  color,
  formatLatency,
  formatPercent,
  formatUsd,
  paint,
  renderTable,
} from '../render';
import { compareRuns } from '../../core/comparison';
import type { CaseChange } from '../../core/comparison';
import type { RunRecord } from '../../core/types';

export async function diffCmd(
  refA: string | undefined,
  refB: string | undefined,
  options: Record<string, unknown>,
): Promise<number> {
  const ctx = createContext(options);
  const runs = ctx.store.listRuns(50);

  if (runs.length < 2) {
    process.stdout.write('need at least two runs to diff\n');
    return 0;
  }

  const b = refB ? resolveRun(ctx, refB, runs) : runs[0]!;
  const a = refA ? resolveRun(ctx, refA, runs) : runs[1]!;
  const comparison = compareRuns(a, b, ctx.store.getResults(a.id), ctx.store.getResults(b.id));
  const { changes } = comparison;

  const rows = changes.map((c) => [
    changeLabel(c),
    c.caseId,
    `${changeStatus(c.before?.status)} ${formatLatency(c.before?.latencyMs ?? 0)}`,
    `${changeStatus(c.after?.status)} ${formatLatency(c.after?.latencyMs ?? 0)}`,
    note(c),
  ]);

  process.stdout.write(
    `${color(ANSI.bold, `${a.label} → ${b.label}`)}  ` +
      `${formatPercent(a.summary.passRate)} → ${formatPercent(b.summary.passRate)} pass  ` +
      `p50 ${formatLatency(a.summary.p50LatencyMs)} → ${formatLatency(b.summary.p50LatencyMs)}  ` +
      `cost ${formatUsd(a.summary.totalCostUsd)} → ${formatUsd(b.summary.totalCostUsd)}\n\n`,
  );
  if (rows.length > 0) {
    process.stdout.write(renderTable(['change', 'case', 'base', 'head', 'note'], rows) + '\n');
  } else {
    process.stdout.write('no changes detected\n');
  }

  const count = (kind: CaseChange['kind']) => changes.filter((c) => c.kind === kind).length;
  process.stdout.write(
    `\n${count('regressed')} regression(s), ${count('fixed')} fixed, ` +
      `${count('added')} added, ${count('removed')} removed, ` +
      `${count('latency-regression')} slower\n`,
  );
  for (const c of changes.filter((x) => x.kind === 'regressed')) {
    process.stdout.write(color(ANSI.red, `  ✗ ${c.caseId} — ${c.title}\n`));
  }
  for (const c of changes.filter((x) => x.kind === 'fixed')) {
    process.stdout.write(color(ANSI.green, `  ✓ fixed: ${c.caseId}\n`));
  }
  for (const c of changes.filter((x) => x.kind === 'latency-regression')) {
    process.stdout.write(
      color(
        ANSI.yellow,
        `  ⏱ slower: ${c.caseId} (${formatLatency(c.before?.latencyMs ?? 0)} → ${formatLatency(c.after?.latencyMs ?? 0)})\n`,
      ),
    );
  }

  if (options['json']) {
    process.stdout.write(JSON.stringify(comparison, null, 2) + '\n');
  }

  const failOnRegression = booleanOption(options['fail-on-regression']);
  return failOnRegression && count('regressed') > 0 ? 1 : 0;
}

function changeLabel(c: CaseChange): string {
  switch (c.kind) {
    case 'regressed':
      return color(ANSI.red, 'regressed');
    case 'fixed':
      return color(ANSI.green, 'fixed');
    case 'latency-regression':
      return color(ANSI.yellow, 'slower');
    case 'added':
      return 'added';
    case 'removed':
      return 'removed';
  }
}

function changeStatus(status: string | undefined): string {
  if (!status) return '-';
  return paint(status);
}

function note(c: CaseChange): string {
  if (c.kind === 'regressed') return 'REGRESSION';
  if (c.kind === 'latency-regression') {
    return `+${(c.after!.latencyMs - c.before!.latencyMs).toFixed(0)}ms`;
  }
  return '';
}

function resolveRun(
  ctx: ReturnType<typeof createContext>,
  ref: string | undefined,
  runs: RunRecord[],
): RunRecord {
  if (!ref) return runs[0]!;
  const found = ctx.store.findRun(ref);
  if (found) return found;
  const byPrefix = runs.find((r) => r.id.startsWith(ref));
  if (byPrefix) return byPrefix;
  process.stdout.write(`run not found: ${ref}\n`);
  process.exit(1);
}
