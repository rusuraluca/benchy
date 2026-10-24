import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cwd } from 'node:process';
import { loadSuite } from '../core/config';
import type { LoadedSuite } from '../core/config';
import { Store } from '../storage/store';

export interface CliContext {
  dir: string;
  store: Store;
  configPath?: string;
  targetUrl?: string;
}

export function resolveDir(option: unknown): string {
  if (typeof option === 'string' && option.length > 0) return resolve(option);
  return join(process.cwd(), '.benchy');
}

export function createContext(options: Record<string, unknown>): CliContext {
  const dir = resolveDir(options.dir);
  return { dir, store: new Store(dir), targetUrl: stringOption(options.target) };
}

export function loadContextSuite(
  context: CliContext,
  options: Record<string, unknown>,
): LoadedSuite {
  const configPath =
    stringOption(options.config) ?? (options.config === true ? 'benchy.yaml' : undefined);
  const path = configPath ?? findDefaultConfig();
  if (!path) {
    throw new Error('no benchy.yaml found — run "benchy init" to scaffold one, or pass --config');
  }
  return loadSuite(path);
}

export function findDefaultConfig(): string | undefined {
  const candidates = ['benchy.yaml', 'benchy.yml'];
  for (const candidate of candidates) {
    const p = resolve(cwd(), candidate);
    if (existsSync(p)) return p;
  }
  return undefined;
}

export function stringOption(option: unknown): string | undefined {
  return typeof option === 'string' && option.length > 0 ? (option as string) : undefined;
}

export function booleanOption(option: unknown): boolean {
  return option === true || option === 'true';
}
