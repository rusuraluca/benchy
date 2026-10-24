import { isPlainObject } from '../core/deepequal';

export interface ExactResult {
  passed: boolean;
  detail: string;
}

export function evaluateExact(expected: unknown, actual: unknown): ExactResult {
  if (deepEquals(expected, actual)) {
    return { passed: true, detail: 'output matches expected' };
  }
  const path = diffPath(expected, actual);
  return { passed: false, detail: `output differs at ${path}` };
}

function deepEquals(expected: unknown, actual: unknown): boolean {
  return diffPath(expected, actual) === undefined;
}

export function diffPath(expected: unknown, actual: unknown, path = '$'): string | undefined {
  if (Object.is(expected, actual)) return undefined;
  if (typeof expected !== typeof actual) return path;
  if (expected === null || actual === null) return path;

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return path;
    if (expected.length !== actual.length) return `${path}.length`;
    for (let i = 0; i < expected.length; i++) {
      const p = diffPath(expected[i], actual[i], `${path}[${i}]`);
      if (p) return p;
    }
    return undefined;
  }

  if (isPlainObject(expected)) {
    if (!isPlainObject(actual)) return path;
    for (const key of Object.keys(expected)) {
      if (!(key in actual)) return `${path}.${key}`;
      const p = diffPath(
        (expected as Record<string, unknown>)[key],
        (actual as Record<string, unknown>)[key],
        `${path}.${key}`,
      );
      if (p) return p;
    }
    return undefined;
  }

  return path;
}
