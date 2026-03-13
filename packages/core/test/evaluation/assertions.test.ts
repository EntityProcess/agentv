import { describe, expect, it } from 'vitest';
import {
  Contains,
  ContainsAll,
  ContainsAny,
  EndsWith,
  ExactMatch,
  IContains,
  IsJson,
  Regex,
  StartsWith,
} from '../../src/evaluation/assertions.js';

const ctx = (output: string, expectedOutput?: string) => ({
  input: 'test-input',
  output,
  expectedOutput,
});

describe('Contains', () => {
  it('scores 1.0 when output contains value', () => {
    const fn = Contains('hello');
    const result = fn(ctx('hello world'));
    expect(result.score).toBe(1.0);
    expect(result.name).toBe('contains');
  });

  it('scores 0.0 when output does not contain value', () => {
    const fn = Contains('goodbye');
    const result = fn(ctx('hello world'));
    expect(result.score).toBe(0.0);
  });
});

describe('IContains', () => {
  it('scores 1.0 case-insensitively', () => {
    const fn = IContains('HELLO');
    const result = fn(ctx('hello world'));
    expect(result.score).toBe(1.0);
  });
});

describe('ContainsAll', () => {
  it('scores 1.0 when all values present', () => {
    const fn = ContainsAll(['hello', 'world']);
    expect(fn(ctx('hello world')).score).toBe(1.0);
  });

  it('scores 0.0 when any value missing', () => {
    const fn = ContainsAll(['hello', 'goodbye']);
    expect(fn(ctx('hello world')).score).toBe(0.0);
  });
});

describe('ContainsAny', () => {
  it('scores 1.0 when any value present', () => {
    const fn = ContainsAny(['goodbye', 'world']);
    expect(fn(ctx('hello world')).score).toBe(1.0);
  });

  it('scores 0.0 when no values present', () => {
    const fn = ContainsAny(['goodbye', 'farewell']);
    expect(fn(ctx('hello world')).score).toBe(0.0);
  });
});

describe('ExactMatch', () => {
  it('scores 1.0 on exact match (trimmed)', () => {
    expect(ExactMatch(ctx('hello', 'hello')).score).toBe(1.0);
    expect(ExactMatch(ctx('  hello  ', 'hello')).score).toBe(1.0);
  });

  it('scores 0.0 on mismatch', () => {
    expect(ExactMatch(ctx('hello', 'world')).score).toBe(0.0);
  });

  it('scores 0.0 when no expectedOutput', () => {
    expect(ExactMatch(ctx('hello')).score).toBe(0.0);
  });
});

describe('StartsWith', () => {
  it('scores 1.0 when output starts with value', () => {
    expect(StartsWith('hello')(ctx('hello world')).score).toBe(1.0);
  });

  it('scores 0.0 when it does not', () => {
    expect(StartsWith('world')(ctx('hello world')).score).toBe(0.0);
  });
});

describe('EndsWith', () => {
  it('scores 1.0 when output ends with value', () => {
    expect(EndsWith('world')(ctx('hello world')).score).toBe(1.0);
  });
});

describe('Regex', () => {
  it('scores 1.0 on match', () => {
    expect(Regex('\\d+')(ctx('abc 123 def')).score).toBe(1.0);
  });

  it('scores 0.0 on no match', () => {
    expect(Regex('^\\d+$')(ctx('abc')).score).toBe(0.0);
  });

  it('supports flags', () => {
    expect(Regex('HELLO', 'i')(ctx('hello')).score).toBe(1.0);
  });
});

describe('IsJson', () => {
  it('scores 1.0 for valid JSON', () => {
    expect(IsJson(ctx('{"a": 1}')).score).toBe(1.0);
  });

  it('scores 0.0 for invalid JSON', () => {
    expect(IsJson(ctx('not json')).score).toBe(0.0);
  });
});
