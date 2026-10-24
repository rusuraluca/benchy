import { createContext, booleanOption } from '../context';
import { createDashboardServer } from '../../dashboard/server';
import { seedDemoRuns } from '../../storage/seed';
import { ANSI, color } from '../render';

export async function serveCmd(options: Record<string, unknown>): Promise<number> {
  const ctx = createContext(options);
  const port = numberOption(options['port']) ?? 4173;

  if (booleanOption(options['demo'])) {
    const seeded = seedDemoRuns(ctx.store, true);
    process.stdout.write(
      seeded > 0
        ? color(ANSI.dim, `seeded ${seeded} demo runs into ${ctx.dir}\n`)
        : color(ANSI.dim, `store already has runs — skipping demo seed\n`),
    );
  }

  const server = createDashboardServer(ctx.store);
  const host = await server.listen(port);
  process.stdout.write(`${color(ANSI.bold, 'benchy dashboard')}  ${color(ANSI.cyan, host)}\n`);
  process.stdout.write(color(ANSI.dim, 'press Ctrl+C to stop\n'));
  return 0;
}

function numberOption(option: unknown): number | undefined {
  const n = typeof option === 'number' ? option : Number(option);
  if (Number.isNaN(n) || n <= 0 || n > 65_535) return undefined;
  return Math.floor(n);
}
