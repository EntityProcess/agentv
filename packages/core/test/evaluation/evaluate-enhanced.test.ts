import { describe, expect, it } from 'vitest';
import { evaluate } from '../../src/evaluation/evaluate.js';

describe('evaluate() — enhanced features', () => {
  it('supports expectedOutput (camelCase)', async () => {
    const { summary } = await evaluate({
      tests: [
        {
          id: 'camel-case',
          input: 'hello',
          expectedOutput: 'world',
          assertions: [{ type: 'equals', value: 'world' }],
        },
      ],
      target: { name: 'default', provider: 'mock', response: 'world' },
    });
    expect(summary.passed).toBe(1);
  });

  it('supports config object assertions', async () => {
    const { summary } = await evaluate({
      tests: [
        {
          id: 'config-test',
          input: 'hello',
          assertions: [{ type: 'contains', value: 'hello' }],
        },
      ],
      target: { name: 'default', provider: 'mock', response: 'hello world' },
    });
    expect(summary.passed).toBe(1);
  });

  it('rejects the removed assertion alias in inline tests', async () => {
    const removedKey = ['ass', 'ert'].join('');
    const removedAliasTest: {
      readonly id: string;
      readonly input: string;
      readonly [key: string]: unknown;
    } = {
      id: 'removed-key',
      input: 'hello',
      [removedKey]: [{ type: 'contains', value: 'hello' }],
    };
    await expect(
      evaluate({
        tests: [removedAliasTest],
        target: { name: 'default', provider: 'mock', response: 'hello world' },
      }),
    ).rejects.toThrow("'assert' has been removed");
  });

  it('supports inline assertion functions', async () => {
    const { summary } = await evaluate({
      tests: [
        {
          id: 'inline-fn',
          input: 'test',
          assertions: [
            ({ output }) => ({
              name: 'custom',
              score: output.includes('test') ? 1.0 : 0.0,
            }),
          ],
        },
      ],
      target: { name: 'default', provider: 'mock', response: 'test output' },
    });
    expect(summary.passed).toBe(1);
  });

  it('supports task function instead of target', async () => {
    const { summary } = await evaluate({
      tests: [
        {
          id: 'task-fn',
          input: 'hello',
          assertions: [{ type: 'contains', value: 'Echo: hello' }],
        },
      ],
      task: async (input) => `Echo: ${input}`,
    });
    expect(summary.passed).toBe(1);
  });

  it('throws when both task and target are provided', async () => {
    await expect(
      evaluate({
        tests: [{ id: 'bad', input: 'x', assertions: [{ type: 'contains', value: 'x' }] }],
        target: { name: 'default', provider: 'mock' },
        task: async (input) => input,
      }),
    ).rejects.toThrow('Cannot specify both');
  });

  it('mixes config objects and inline functions', async () => {
    const { summary } = await evaluate({
      tests: [
        {
          id: 'mixed',
          input: 'hello world',
          assertions: [
            { type: 'contains', value: 'hello' },
            { type: 'contains', value: 'world' },
            ({ output }) => ({
              name: 'has-space',
              score: output.includes(' ') ? 1.0 : 0.0,
            }),
          ],
        },
      ],
      target: { name: 'default', provider: 'mock', response: 'hello world' },
    });
    expect(summary.passed).toBe(1);
  });

  it('supports suite-level assertions with inline function', async () => {
    const { summary } = await evaluate({
      tests: [
        { id: 'a', input: 'hello' },
        { id: 'b', input: 'world' },
      ],
      assertions: [{ type: 'contains', value: 'response' }],
      target: { name: 'default', provider: 'mock', response: 'response text' },
    });
    expect(summary.total).toBe(2);
    expect(summary.passed).toBe(2);
  });

  it('supports legacy expected_output for backwards compatibility', async () => {
    const { summary } = await evaluate({
      tests: [
        {
          id: 'legacy',
          input: 'hello',
          expected_output: 'world',
          assertions: [{ type: 'equals', value: 'world' }],
        },
      ],
      target: { name: 'default', provider: 'mock', response: 'world' },
    });
    expect(summary.passed).toBe(1);
  });
});
