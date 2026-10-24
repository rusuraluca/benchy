import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { parse } from 'yaml';
import { isPlainObject } from './deepequal';
import type { BenchConfig, CaseSpec } from './types';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface LoadedSuite {
  config: BenchConfig;
  cases: CaseSpec[];
  configPath: string;
}

const BASE_METHODS: CaseSpec['method'][] = ['GET', 'POST', 'PUT'];

export function loadSuite(configPath: string): LoadedSuite {
  const absolute = isAbsolute(configPath) ? configPath : resolve(configPath);
  const raw = readSuiteFile(absolute);
  if (!isPlainObject(raw)) {
    throw new ConfigError(`${absolute}: top-level must be a YAML mapping`);
  }
  const importsRaw = raw.imports;
  const cases: CaseSpec[] = [];
  if (importsRaw !== undefined) {
    if (!Array.isArray(importsRaw) || importsRaw.some((i) => typeof i !== 'string')) {
      throw new ConfigError(`${absolute}: "imports" must be a list of file paths`);
    }
    for (const file of importsRaw) {
      const imported = resolve(dirname(absolute), file as string);
      const doc = readSuiteFile(imported);
      const importedCases = Array.isArray(doc) ? doc : isPlainObject(doc) ? doc.cases : [];
      if (!Array.isArray(importedCases)) {
        throw new ConfigError(`${imported}: "cases" must be a list`);
      }
      for (const [i, spec] of importedCases.entries()) {
        cases.push(parseCase(spec as unknown, `${imported}:cases[${i}]`));
      }
    }
  }

  const inlineCases = raw.cases ?? [];
  if (!Array.isArray(inlineCases)) {
    throw new ConfigError(`${absolute}: "cases" must be a list`);
  }
  for (const [i, spec] of inlineCases.entries()) {
    cases.push(parseCase(spec, `${absolute}:cases[${i}]`));
  }

  const ids = new Set<string>();
  for (const c of cases) {
    if (ids.has(c.id)) throw new ConfigError(`${absolute}: duplicate test case id "${c.id}"`);
    ids.add(c.id);
  }

  const config = parseConfig(raw, absolute);
  return { config, cases, configPath: absolute };
}

function readSuiteFile(path: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new ConfigError(`cannot read config file: ${path}`);
  }
  try {
    return parse(text);
  } catch (e) {
    throw new ConfigError(`invalid YAML in ${path}: ${(e as Error).message}`);
  }
}

function parseConfig(raw: Record<string, unknown>, file: string): BenchConfig {
  const target = raw.target;
  if (!isPlainObject(target)) {
    throw new ConfigError(`${file}: missing "target" mapping with a "url"`);
  }
  if (typeof target.url !== 'string' || target.url.length === 0) {
    throw new ConfigError(`${file}: "target.url" must be a non-empty string`);
  }
  if (target.model !== undefined && typeof target.model !== 'string') {
    throw new ConfigError(`${file}: "target.model" must be a string`);
  }
  const name = raw.name ?? 'benchy';
  if (typeof name !== 'string') throw new ConfigError(`${file}: "name" must be a string`);

  const pricing = parsePricing(raw.pricing, file);
  const judge = parseJudge(raw.judge, file);

  return {
    name,
    target: {
      url: target.url,
      model: target.model as string | undefined,
    },
    concurrency: parseNumber(raw.concurrency, 'concurrency', file, 3),
    retries: parseNumber(raw.retries, 'retries', file, 0),
    timeoutMs: parseNumber(raw.timeoutMs, 'timeoutMs', file, 30_000),
    pricing,
    judge,
  };
}

function parsePricing(raw: unknown, file: string): BenchConfig['pricing'] {
  if (raw === undefined) return undefined;
  if (!isPlainObject(raw)) {
    throw new ConfigError(`${file}: "pricing" must be a mapping of model -> {input, output}`);
  }
  const out: BenchConfig['pricing'] = {};
  for (const [model, spec] of Object.entries(raw)) {
    if (!isPlainObject(spec)) {
      throw new ConfigError(
        `${file}: pricing["${model}"] must be a mapping with input/output per-million-token USD prices`,
      );
    }
    const input = spec.input;
    const output = spec.output;
    if (typeof input !== 'number' || input < 0 || typeof output !== 'number' || output < 0) {
      throw new ConfigError(
        `${file}: pricing["${model}"] needs non-negative numbers "input" and "output"`,
      );
    }
    out[model] = { input, output };
  }
  return out;
}

function parseJudge(raw: unknown, file: string): BenchConfig['judge'] {
  if (raw === undefined) return undefined;
  if (!isPlainObject(raw)) {
    throw new ConfigError(`${file}: "judge" must be a mapping`);
  }
  const judge: BenchConfig['judge'] = {};
  if (raw.model !== undefined) {
    if (typeof raw.model !== 'string')
      throw new ConfigError(`${file}: judge.model must be a string`);
    judge.model = raw.model;
  }
  if (raw.baseUrl !== undefined) {
    if (typeof raw.baseUrl !== 'string')
      throw new ConfigError(`${file}: judge.baseUrl must be a string`);
    judge.baseUrl = raw.baseUrl;
  }
  if (raw.apiKeyEnv !== undefined) {
    if (typeof raw.apiKeyEnv !== 'string')
      throw new ConfigError(`${file}: judge.apiKeyEnv must be a string`);
    judge.apiKeyEnv = raw.apiKeyEnv;
  }
  if (raw.temperature !== undefined) {
    if (typeof raw.temperature !== 'number')
      throw new ConfigError(`${file}: judge.temperature must be a number`);
    judge.temperature = raw.temperature;
  }
  return judge;
}

function parseNumber(v: unknown, key: string, file: string, dflt: number): number {
  if (v === undefined) return dflt;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
    throw new ConfigError(`${file}: "${key}" must be a non-negative number`);
  }
  return v;
}

function parseCase(raw: unknown, file: string): CaseSpec {
  if (!isPlainObject(raw)) throw new ConfigError(`${file}: test case must be a mapping`);
  if (typeof raw.id !== 'string' || raw.id.length === 0) {
    throw new ConfigError(`${file}: "id" is required and must be a non-empty string`);
  }
  if (raw.name !== undefined && typeof raw.name !== 'string') {
    throw new ConfigError(`${file}: "name" must be a string`);
  }
  if (raw.tags !== undefined) {
    if (!Array.isArray(raw.tags) || raw.tags.some((t) => typeof t !== 'string')) {
      throw new ConfigError(`${file}: "tags" must be a list of strings`);
    }
  }
  if (raw.method !== undefined && !BASE_METHODS.includes(raw.method as CaseSpec['method'])) {
    throw new ConfigError(`${file}: "method" must be one of GET, POST, PUT`);
  }
  if (raw.path !== undefined && typeof raw.path !== 'string') {
    throw new ConfigError(`${file}: "path" must be a string`);
  }
  if (raw.headers !== undefined && !isPlainObject(raw.headers)) {
    throw new ConfigError(`${file}: "headers" must be a mapping`);
  }
  for (const key of ['timeoutMs', 'retries'] as const) {
    const v = raw[key];
    if (v !== undefined && (typeof v !== 'number' || v < 0)) {
      throw new ConfigError(`${file}: "${key}" must be a non-negative number`);
    }
  }
  if (raw.required !== undefined && typeof raw.required !== 'boolean') {
    throw new ConfigError(`${file}: "required" must be a boolean`);
  }

  const expected = raw.expected;
  let parsedExpected: CaseSpec['expected'];
  if (expected !== undefined) {
    if (!isPlainObject(expected)) throw new ConfigError(`${file}: "expected" must be a mapping`);
    parsedExpected = {};
    if (expected.output !== undefined) parsedExpected.output = expected.output;
    if (expected.schema !== undefined) {
      parsedExpected.schema = parseSchema(expected.schema, `${file}:expected.schema`);
    }
    if (expected.judge !== undefined) {
      if (!isPlainObject(expected.judge)) {
        throw new ConfigError(`${file}:expected.judge must be a mapping`);
      }
      if (typeof expected.judge.criteria !== 'string' || expected.judge.criteria.length === 0) {
        throw new ConfigError(`${file}:expected.judge.criteria is required`);
      }
      const judge: NonNullable<CaseSpec['expected']>['judge'] = {
        criteria: expected.judge.criteria,
      };
      if (expected.judge.scale !== undefined) {
        if (typeof expected.judge.scale !== 'string') {
          throw new ConfigError(`${file}:expected.judge.scale must be a string`);
        }
        judge.scale = expected.judge.scale;
      }
      if (expected.judge.required !== undefined) {
        if (typeof expected.judge.required !== 'boolean') {
          throw new ConfigError(`${file}:expected.judge.required must be a boolean`);
        }
        judge.required = expected.judge.required;
      }
      parsedExpected.judge = judge;
    }
    if (
      parsedExpected.output === undefined &&
      parsedExpected.schema === undefined &&
      parsedExpected.judge === undefined
    ) {
      throw new ConfigError(`${file}: expected must define at least one of output/schema/judge`);
    }
  }

  if (parsedExpected === undefined) {
    throw new ConfigError(`${file}: case must define "expected" (output, schema and/or judge)`);
  }

  return {
    id: raw.id as string,
    name: (raw.name as string | undefined) ?? (raw.id as string),
    tags: raw.tags as string[] | undefined,
    method: (raw.method as CaseSpec['method'] | undefined) ?? 'POST',
    path: raw.path as string | undefined,
    input: raw.input,
    headers: raw.headers as Record<string, string> | undefined,
    expected: parsedExpected,
    required: (raw.required as boolean | undefined) ?? true,
    timeoutMs: raw.timeoutMs as number | undefined,
    retries: raw.retries as number | undefined,
  };
}

function parseSchema(raw: unknown, loc: string): unknown {
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    try {
      return JSON.parse(trimmed);
    } catch {
      try {
        const parsed = parse(trimmed);
        if (!isPlainObject(parsed)) {
          throw new ConfigError(`${loc}: schema must parse to an object`);
        }
        return parsed;
      } catch (e) {
        if (e instanceof ConfigError) throw e;
        throw new ConfigError(`${loc}: invalid JSON/YAML schema: ${(e as Error).message}`);
      }
    }
  }
  if (!isPlainObject(raw)) {
    throw new ConfigError(`${loc}: schema must be an object or a JSON/YAML string`);
  }
  return raw;
}
