import { describe, expect, it } from 'vitest';
import { deepEqual, diffPath, isPlainObject } from '../src/core/deepequal';

describe('deepEqual', () => {
  it('matches primitives', () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual('a', 'a')).toBe(true);
    expect(deepEqual(null, null)).toBe(true);
    expect(deepEqual(true, false)).toBe(false);
    expect(deepEqual(1, '1')).toBe(false);
    expect(deepEqual(NaN, NaN)).toBe(true);
  });

  it('matches arrays and objects', () => {
    expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(deepEqual({ a: 1, b: { c: 2 } }, { b: { c: 2 }, a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it('ignores non-plain objects', () => {
    expect(deepEqual(new Date(0), new Date(0))).toBe(false);
  });
});

describe('diffPath', () => {
  it('finds first divergence', () => {
    expect(diffPath({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe('$.b');
    expect(diffPath({ arr: [1, 2] }, { arr: [1, 3] })).toBe('$.arr[1]');
    expect(diffPath([1, 2], [1])).toBe('$.length');
  });

  it('returns undefined for equal values', () => {
    expect(diffPath({ a: 1 }, { a: 1 })).toBeUndefined();
  });
});

describe('isPlainObject', () => {
  it('detects plain objects', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject(Object.create(null))).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject('x')).toBe(false);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject(new Map())).toBe(false);
  });
});
