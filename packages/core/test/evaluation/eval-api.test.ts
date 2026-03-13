import { afterEach, describe, expect, it } from 'vitest';
import { Contains } from '../../src/evaluation/assertions.js';
import {
  Eval,
  type EvalDataItem,
  clearEvalRegistry,
  getRegisteredEvals,
} from '../../src/evaluation/eval-api.js';

afterEach(() => {
  clearEvalRegistry();
});

describe('Eval() registration', () => {
  it('registers an eval in the global registry', () => {
    Eval('test-eval', {
      data: [{ input: 'hello', expectedOutput: 'world' }],
      target: { name: 'default', provider: 'mock', response: 'world' },
      assert: [Contains('world')],
    });

    const registry = getRegisteredEvals();
    expect(registry.size).toBe(1);
    expect(registry.has('test-eval')).toBe(true);
  });

  it('throws on duplicate eval names', () => {
    Eval('dup', {
      data: [{ input: 'a' }],
      target: { name: 'default', provider: 'mock' },
      assert: [Contains('a')],
    });

    expect(() => {
      Eval('dup', {
        data: [{ input: 'b' }],
        target: { name: 'default', provider: 'mock' },
        assert: [Contains('b')],
      });
    }).toThrow('Eval "dup" already registered');
  });

  it('throws when both task and target are provided', () => {
    expect(() => {
      Eval('bad', {
        data: [{ input: 'a' }],
        target: { name: 'default', provider: 'mock' },
        task: async (input) => input,
        assert: [Contains('a')],
      });
    }).toThrow('Cannot specify both "task" and "target"');
  });

  it('throws when neither task nor target is provided', () => {
    expect(() => {
      Eval('bad', {
        data: [{ input: 'a' }],
        assert: [Contains('a')],
      });
    }).toThrow('Must specify either "task" or "target"');
  });
});

describe('Eval() execution with mock target', () => {
  it('returns results when awaited', async () => {
    const result = await Eval('exec-test', {
      data: [{ id: 'case-1', input: 'hello', expectedOutput: 'world' }],
      target: { name: 'default', provider: 'mock', response: 'world' },
      assert: [Contains('world')],
    });

    expect(result.results).toHaveLength(1);
    expect(result.summary.total).toBe(1);
    expect(result.summary.passed).toBe(1);
  });

  it('auto-generates test IDs from eval name and index', async () => {
    const result = await Eval('auto-id', {
      data: [{ input: 'first' }, { input: 'second' }],
      target: { name: 'default', provider: 'mock', response: 'first second' },
      assert: [Contains('first')],
    });

    expect(result.results[0].testId).toBe('auto-id/0');
    expect(result.results[1].testId).toBe('auto-id/1');
  });

  it('uses explicit data item IDs in test IDs', async () => {
    const result = await Eval('explicit-id', {
      data: [{ id: 'my-case', input: 'hello' }],
      target: { name: 'default', provider: 'mock', response: 'hello' },
      assert: [Contains('hello')],
    });

    expect(result.results[0].testId).toBe('explicit-id/my-case');
  });

  it('supports inline assertion functions', async () => {
    const result = await Eval('inline-fn', {
      data: [{ input: 'test', expectedOutput: 'test' }],
      target: { name: 'default', provider: 'mock', response: 'test' },
      assert: [
        ({ output, expectedOutput }) => ({
          name: 'custom',
          score: output === expectedOutput ? 1.0 : 0.0,
        }),
      ],
    });

    expect(result.summary.passed).toBe(1);
  });

  it('supports async data factory', async () => {
    const result = await Eval('async-data', {
      data: async () => [{ input: 'hello' }],
      target: { name: 'default', provider: 'mock', response: 'hello' },
      assert: [Contains('hello')],
    });

    expect(result.results).toHaveLength(1);
  });

  it('supports task function instead of target', async () => {
    const result = await Eval('task-fn', {
      data: [{ input: 'hello' }],
      task: async (input) => `Echo: ${input}`,
      assert: [Contains('Echo: hello')],
    });

    expect(result.summary.passed).toBe(1);
  });

  it('supports mixing inline functions and assertion configs', async () => {
    const result = await Eval('mixed', {
      data: [{ input: 'hello world' }],
      target: { name: 'default', provider: 'mock', response: 'hello world' },
      assert: [
        Contains('hello'),
        ({ output }) => ({ name: 'has-world', score: output.includes('world') ? 1.0 : 0.0 }),
        { type: 'contains', value: 'world' },
      ],
    });

    expect(result.summary.passed).toBe(1);
  });
});
