import { describe, expect, it } from 'vitest';
import { evaluate } from '../../src/evaluation/evaluate.js';

describe('evaluate() — enhanced features', () => {
  it('supports expectedOutput (camelCase)', async () => {
    const { summary } = await evaluate({
      prompts: ['{{ input }}'],
      tests: [
        {
          id: 'camel-case',
          vars: { input: 'hello' },
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
      prompts: ['{{ input }}'],
      tests: [
        {
          id: 'config-test',
          vars: { input: 'hello' },
          assertions: [{ type: 'contains', value: 'hello' }],
        },
      ],
      target: { name: 'default', provider: 'mock', response: 'hello world' },
    });
    expect(summary.passed).toBe(1);
  });

  it('supports canonical assert in inline tests', async () => {
    const { summary } = await evaluate({
      prompts: ['{{ input }}'],
      tests: [
        {
          id: 'canonical-assert',
          vars: { input: 'hello' },
          assert: [{ type: 'contains', value: 'hello' }],
        },
      ],
      target: { name: 'default', provider: 'mock', response: 'hello world' },
    });
    expect(summary.passed).toBe(1);
  });

  it('supports inline assertion functions', async () => {
    const { summary } = await evaluate({
      prompts: ['{{ input }}'],
      tests: [
        {
          id: 'inline-fn',
          vars: { input: 'test' },
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
      prompts: ['{{ input }}'],
      tests: [
        {
          id: 'task-fn',
          vars: { input: 'hello' },
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
        prompts: ['{{ input }}'],
        tests: [
          { id: 'bad', vars: { input: 'x' }, assertions: [{ type: 'contains', value: 'x' }] },
        ],
        target: { name: 'default', provider: 'mock' },
        task: async (input) => input,
      }),
    ).rejects.toThrow('Cannot specify both');
  });

  it('mixes config objects and inline functions', async () => {
    const { summary } = await evaluate({
      prompts: ['{{ input }}'],
      tests: [
        {
          id: 'mixed',
          vars: { input: 'hello world' },
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
      prompts: ['{{ input }}'],
      tests: [
        { id: 'a', vars: { input: 'hello' } },
        { id: 'b', vars: { input: 'world' } },
      ],
      assertions: [{ type: 'contains', value: 'response' }],
      target: { name: 'default', provider: 'mock', response: 'response text' },
    });
    expect(summary.total).toBe(2);
    expect(summary.passed).toBe(2);
  });

  it('rejects removed expected_output in inline tests', async () => {
    const removedKey = ['expected', 'output'].join('_');
    const removedAliasTest: {
      readonly id: string;
      readonly vars: { readonly input: string };
      readonly assertions: readonly { readonly type: string; readonly value: string }[];
      readonly [key: string]: unknown;
    } = {
      id: 'removed-expected-output',
      vars: { input: 'hello' },
      [removedKey]: 'world',
      assertions: [{ type: 'equals', value: 'world' }],
    };
    await expect(
      evaluate({
        prompts: ['{{ input }}'],
        tests: [removedAliasTest],
        target: { name: 'default', provider: 'mock', response: 'world' },
      }),
    ).rejects.toThrow("'expected_output' has been removed");
  });
});
