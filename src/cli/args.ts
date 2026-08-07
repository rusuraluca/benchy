import minimist from 'minimist';

export interface CliOptions {
  [key: string]: unknown;
}

const STRING_KEYS = [
  'config',
  'dir',
  'target',
  'label',
  'name',
  'tag',
  'port',
  'from',
  'to',
  'baseline',
  'file',
];

const BOOLEAN_KEYS = [
  'json',
  'help',
  'version',
  'force',
  'allow-fail',
  'latest',
  'if-empty',
  'open',
  'demo',
  'fail-on-regression',
];

export interface ParsedArgs {
  command: string | undefined;
  subcommand: string | undefined;
  rest: string[];
  options: Record<string, unknown>;
}

export function parseCliArgs(argv: string[]): ParsedArgs {
  const parsed = minimist(argv, {
    string: STRING_KEYS,
    boolean: BOOLEAN_KEYS,
    alias: {
      c: 'config',
      d: 'dir',
      t: 'target',
      l: 'label',
      j: 'json',
      p: 'port',
      h: 'help',
      v: 'version',
      n: 'name',
    },
  });
  const command = parsed._[0];
  const rest = parsed._.slice(1) as string[];
  const options: Record<string, unknown> = {};
  for (const key of [...STRING_KEYS, ...BOOLEAN_KEYS]) {
    if (parsed[key] !== undefined) options[key] = parsed[key];
  }
  return { command, subcommand: rest[0], rest, options };
}
