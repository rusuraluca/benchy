export const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

export function color(code: string, text: string): string {
  if (process.env.NO_COLOR) return text;
  return `${code}${text}${ANSI.reset}`;
}

export function paint(status: string): string {
  switch (status) {
    case 'passed':
      return color(ANSI.green, status);
    case 'failed':
      return color(ANSI.red, status);
    case 'skipped':
      return color(ANSI.yellow, status);
    case 'error':
      return color(ANSI.magenta, status);
    default:
      return status;
  }
}

export function formatLatency(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms >= 100) return `${ms.toFixed(0)}ms`;
  if (ms > 0) return `${ms.toFixed(1)}ms`;
  return '-';
}

export function formatUsd(usd: number): string {
  if (usd === 0) return '$0';
  if (usd < 0.01) return `$${usd.toFixed(5)}`;
  return `$${usd.toFixed(4)}`;
}

export function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(0)}%`;
}

export interface TableColumn {
  key: string;
  title: string;
  width: number;
  align?: 'left' | 'right';
}

export function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cells: string[]): string => cells.map((c, i) => c.padEnd(widths[i]!)).join('  ');
  const sep = widths.map((w) => '-'.repeat(w)).join('--');
  return [line(headers), sep, ...rows.map(line)].join('\n');
}

export function truncate(text: string, max = 120): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

export function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
