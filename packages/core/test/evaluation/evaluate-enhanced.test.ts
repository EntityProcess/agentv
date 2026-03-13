import { describe, expect, it } from 'vitest';
import { contains, exactMatch } from '../../src/evaluation/assertions.js';
import { evaluate } from '../../src/evaluation/evaluate.js';

describe('evaluate() — enhanced features', () => {
  it('supports expectedOutput (camelCase)', async () => {
    const { summary } = await evaluate({
      tests: [
        {
          id: 'camel-case',
          input: 'hello',
          expectedOutput: 'world',
          assert: [exactMatch],
        },
      ],
      target: { name: 'default', provider: 'mock', response: 'world' },
    });
    expect(summary.passed).toBe(1);
  });

  it('supports assertion factory functions in assert array', async () => {
    const { summary } = await evaluate({
      tests: [
        {
          id: 'factory-test',
          input: 'hello',
          assert: [contains('hello')],
        },
      ],
      target: { name: 'default', provider: 'mock', response: 'hello world' },
    });
    expect(summary.passed).toBe(1);
  });

  it('supports inline assertion functions', async () => {
    const { summary } = await evaluate({
      tests: [
        {
          id: 'inline-fn',
          input: 'test',
          assert: [
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
          assert: [contains('Echo: hello')],
        },
      ],
      task: async (input) => `Echo: ${input}`,
    });
    expect(summary.passed).toBe(1);
  });

  it('throws when both task and target are provided', async () => {
    await expect(
      evaluate({
        tests: [{ id: 'bad', input: 'x', assert: [contains('x')] }],
        target: { name: 'default', provider: 'mock' },
        task: async (input) => input,
      }),
    ).rejects.toThrow('Cannot specify both');
  });

  it('mixes factory functions, config objects, and inline functions', async () => {
    const { summary } = await evaluate({
      tests: [
        {
          id: 'mixed',
          input: 'hello world',
          assert: [
            contains('hello'),
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

  it('supports suite-level assert with AssertFn', async () => {
    const { summary } = await evaluate({
      tests: [
        { id: 'a', input: 'hello' },
        { id: 'b', input: 'world' },
      ],
      assert: [contains('response')],
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
          assert: [exactMatch],
        },
      ],
      target: { name: 'default', provider: 'mock', response: 'world' },
    });
    expect(summary.passed).toBe(1);
  });
});
