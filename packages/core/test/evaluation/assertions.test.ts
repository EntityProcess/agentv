import { describe, expect, it } from 'vitest';
import {
  contains,
  containsAll,
  containsAny,
  endsWith,
  exactMatch,
  icontains,
  isJson,
  regex,
  startsWith,
} from '../../src/evaluation/assertions.js';

const ctx = (output: string, expectedOutput?: string) => ({
  input: 'test-input',
  output,
  expectedOutput,
});

describe('contains', () => {
  it('scores 1.0 when output contains value', () => {
    const fn = contains('hello');
    const result = fn(ctx('hello world'));
    expect(result.score).toBe(1.0);
    expect(result.name).toBe('contains');
  });

  it('scores 0.0 when output does not contain value', () => {
    const fn = contains('goodbye');
    const result = fn(ctx('hello world'));
    expect(result.score).toBe(0.0);
  });
});

describe('icontains', () => {
  it('scores 1.0 case-insensitively', () => {
    const fn = icontains('HELLO');
    const result = fn(ctx('hello world'));
    expect(result.score).toBe(1.0);
  });

  it('scores 0.0 when value not present', () => {
    expect(icontains('goodbye')(ctx('hello world')).score).toBe(0.0);
  });
});

describe('containsAll', () => {
  it('scores 1.0 when all values present', () => {
    const fn = containsAll(['hello', 'world']);
    expect(fn(ctx('hello world')).score).toBe(1.0);
  });

  it('scores 0.0 when any value missing', () => {
    const fn = containsAll(['hello', 'goodbye']);
    expect(fn(ctx('hello world')).score).toBe(0.0);
  });
});

describe('containsAny', () => {
  it('scores 1.0 when any value present', () => {
    const fn = containsAny(['goodbye', 'world']);
    expect(fn(ctx('hello world')).score).toBe(1.0);
  });

  it('scores 0.0 when no values present', () => {
    const fn = containsAny(['goodbye', 'farewell']);
    expect(fn(ctx('hello world')).score).toBe(0.0);
  });
});

describe('exactMatch', () => {
  it('scores 1.0 on exact match (trimmed)', () => {
    expect(exactMatch(ctx('hello', 'hello')).score).toBe(1.0);
    expect(exactMatch(ctx('  hello  ', 'hello')).score).toBe(1.0);
  });

  it('scores 0.0 on mismatch', () => {
    expect(exactMatch(ctx('hello', 'world')).score).toBe(0.0);
  });

  it('scores 0.0 when no expectedOutput', () => {
    expect(exactMatch(ctx('hello')).score).toBe(0.0);
  });
});

describe('startsWith', () => {
  it('scores 1.0 when output starts with value', () => {
    expect(startsWith('hello')(ctx('hello world')).score).toBe(1.0);
  });

  it('scores 0.0 when it does not', () => {
    expect(startsWith('world')(ctx('hello world')).score).toBe(0.0);
  });
});

describe('endsWith', () => {
  it('scores 1.0 when output ends with value', () => {
    expect(endsWith('world')(ctx('hello world')).score).toBe(1.0);
  });

  it('scores 0.0 when output does not end with value', () => {
    expect(endsWith('hello')(ctx('hello world')).score).toBe(0.0);
  });
});

describe('regex', () => {
  it('scores 1.0 on match', () => {
    expect(regex('\\d+')(ctx('abc 123 def')).score).toBe(1.0);
  });

  it('scores 0.0 on no match', () => {
    expect(regex('^\\d+$')(ctx('abc')).score).toBe(0.0);
  });

  it('supports flags', () => {
    expect(regex('HELLO', 'i')(ctx('hello')).score).toBe(1.0);
  });
});

describe('isJson', () => {
  it('scores 1.0 for valid JSON', () => {
    expect(isJson(ctx('{"a": 1}')).score).toBe(1.0);
  });

  it('scores 0.0 for invalid JSON', () => {
    expect(isJson(ctx('not json')).score).toBe(0.0);
  });
});
