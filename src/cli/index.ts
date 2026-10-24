#!/usr/bin/env node
import { parseCliArgs } from './args';
import { ConfigError } from '../core/config';
import { runCmd } from './commands/run';
import { listCmd, showCmd } from './commands/query';
import { diffCmd } from './commands/diff';
import { baselineCmd } from './commands/baseline';
import { serveCmd } from './commands/serve';
import { initCmd } from './commands/init';
import { createContext } from './context';
import { seedDemoRuns } from '../storage/seed';
import { ANSI, color } from './render';

const VERSION = '0.1.0';

const USAGE = `benchy — drop-in eval suite for LLM apps

Usage: benchy <command> [options]

Commands:
  run              Run the eval suite against your app, store the result
  list             List recent runs
  show [run]       Inspect one run (latest by default)
  diff [a] [b]     Compare two runs/versions: regressions, fixes, latency
  baseline         Manage the pass/fail baseline used by CI:
                     update | check
  serve            Launch the results dashboard (default port 4173)
  init             Scaffold benchy.yaml in the current directory
  init-demo        Seed the store with demo runs to explore the dashboard
  version          Print the version
  help             Show this help

Options (most commands):
  --config PATH    benchy.yaml path (default: ./benchy.yaml)
  --dir PATH       store directory (default: ./.benchy)
  --target URL     override the target URL from the config
  --label NAME     version tag for this run (e.g. v1.2)
  --tag TAG        only run test cases with this tag
  --name NEEDLE    only run test cases with this id/name
  --concurrency N  parallel requests (default: from config)
  --baseline FILE  baseline json file (default: benchy-baseline.json)
  --json           machine-readable output
  --allow-fail     exit 0 even when cases fail
  -h, --help       show this help
`;

export async function main(argv: string[]): Promise<number> {
  const { command, rest, options } = parseCliArgs(argv);

  if (options['version'] || command === 'version') {
    process.stdout.write(`benchy v${VERSION}\n`);
    return 0;
  }
  if (command === 'help' || command === undefined) {
    process.stdout.write(USAGE);
    return command === 'help' ? 0 : 1;
  }

  try {
    switch (command) {
      case 'run':
        return await runCmd(options);
      case 'list':
        return await listCmd(options);
      case 'show':
        return await showCmd(rest[0], options);
      case 'diff':
        return await diffCmd(rest[0], rest[1], options);
      case 'baseline':
        return await baselineCmd(rest[0], options);
      case 'serve':
        return await serveCmd(options);
      case 'init':
        return await initCmd(process.cwd(), options);
      case 'init-demo':
        return await initDemoCmd(options);
      default:
        process.stdout.write(`unknown command: ${command}\n\n${USAGE}`);
        return 1;
    }
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`${err.message}\n`);
      return 1;
    }
    throw err;
  }
}

async function initDemoCmd(options: Record<string, unknown>): Promise<number> {
  const ctx = createContext(options);
  const seeded = seedDemoRuns(ctx.store, options['if-empty'] === true);
  process.stdout.write(
    seeded > 0
      ? `${color(ANSI.green, `seeded ${seeded} demo runs`)} into ${ctx.dir}\n`
      : color(ANSI.yellow, 'store already has runs — use --if-empty or a fresh --dir\n'),
  );
  return 0;
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    process.stderr.write(`benchy: ${(err as Error).message}\n`);
    process.exitCode = 1;
  });
