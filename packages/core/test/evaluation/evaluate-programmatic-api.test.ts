/**
 * Tests for the programmatic API extensions: beforeAll, budgetUsd, turns, aggregation.
 *
 * Validates that the new EvalConfig and EvalTestInput fields are accepted by
 * evaluate() and correctly converted to internal EvalTest / RunEvaluationOptions.
 */

import { describe, expect, it } from 'bun:test';
import path from 'node:path';
import { evaluate } from '../../src/evaluation/evaluate.js';

describe('evaluate() — programmatic API extensions', () => {
  // ---------------------------------------------------------------------------
  // budgetUsd
  // ---------------------------------------------------------------------------

  it('accepts budgetUsd and passes it to the orchestrator', async () => {
    const { summary } = await evaluate({
      tests: [
        {
          id: 'budget-test',
          input: 'hello',
          assert: [{ type: 'contains', value: 'hello' }],
        },
      ],
      target: { name: 'default', provider: 'mock', response: 'hello world' },
      budgetUsd: 10.0,
    });
    expect(summary.passed).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // turns + mode: 'conversation'
  // ---------------------------------------------------------------------------

  it('accepts turns with explicit conversation mode', async () => {
    const { summary, results } = await evaluate({
      tests: [
        {
          id: 'conversation-explicit',
          mode: 'conversation',
          turns: [
            {
              input: 'Hello',
              assert: [{ type: 'contains', value: 'mock' }],
            },
            {
              input: 'How are you?',
              assert: [{ type: 'contains', value: 'mock' }],
            },
          ],
        },
      ],
      target: { name: 'default', provider: 'mock', response: 'mock response' },
    });
    expect(summary.total).toBe(1);
    expect(results.length).toBe(1);
  });

  it('infers conversation mode when turns[] is provided without explicit mode', async () => {
    const { summary } = await evaluate({
      tests: [
        {
          id: 'conversation-inferred',
          turns: [
            {
              input: 'First turn',
              assert: [{ type: 'contains', value: 'mock' }],
            },
          ],
        },
      ],
      target: { name: 'default', provider: 'mock', response: 'mock response' },
    });
    expect(summary.total).toBe(1);
  });

  it('supports expectedOutput on individual turns', async () => {
    const { summary } = await evaluate({
      tests: [
        {
          id: 'turn-expected-output',
          turns: [
            {
              input: 'Say hello',
              expectedOutput: 'Hello!',
              assert: [{ type: 'contains', value: 'mock' }],
            },
          ],
        },
      ],
      target: { name: 'default', provider: 'mock', response: 'mock response' },
    });
    expect(summary.total).toBe(1);
  });

  it('supports message array input in turns', async () => {
    const { summary } = await evaluate({
      tests: [
        {
          id: 'turn-message-array',
          turns: [
            {
              input: [
                { role: 'system', content: 'You are helpful' },
                { role: 'user', content: 'Hello' },
              ],
              assert: [{ type: 'contains', value: 'mock' }],
            },
          ],
        },
      ],
      target: { name: 'default', provider: 'mock', response: 'mock response' },
    });
    expect(summary.total).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // aggregation
  // ---------------------------------------------------------------------------

  it('accepts aggregation on conversation tests', async () => {
    const { summary } = await evaluate({
      tests: [
        {
          id: 'aggregation-min',
          turns: [
            {
              input: 'Turn 1',
              assert: [{ type: 'contains', value: 'mock' }],
            },
            {
              input: 'Turn 2',
              assert: [{ type: 'contains', value: 'mock' }],
            },
          ],
          aggregation: 'min',
        },
      ],
      target: { name: 'default', provider: 'mock', response: 'mock response' },
    });
    expect(summary.total).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // beforeAll
  // ---------------------------------------------------------------------------

  it('accepts beforeAll as a string', async () => {
    // beforeAll requires a workspace to execute in; without repos it just attaches
    // the hook config. This test verifies the type is accepted without throwing.
    const { summary } = await evaluate({
      tests: [
        {
          id: 'before-all-string',
          input: 'hello',
          assert: [{ type: 'contains', value: 'test' }],
        },
      ],
      target: { name: 'default', provider: 'mock', response: 'test output' },
      beforeAll: 'echo "setup complete"',
    });
    expect(summary.total).toBe(1);
  });

  it('accepts beforeAll as a string array', async () => {
    const { summary } = await evaluate({
      tests: [
        {
          id: 'before-all-array',
          input: 'hello',
          assert: [{ type: 'contains', value: 'test' }],
        },
      ],
      target: { name: 'default', provider: 'mock', response: 'test output' },
      beforeAll: ['echo', 'setup complete'],
    });
    expect(summary.total).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Combined usage
  // ---------------------------------------------------------------------------

  it('supports all new fields together', async () => {
    const { summary } = await evaluate({
      tests: [
        {
          id: 'combined-test',
          turns: [
            {
              input: 'Hello',
              expectedOutput: 'Hi there',
              assert: [{ type: 'contains', value: 'mock' }],
            },
            {
              input: 'Goodbye',
              assert: [{ type: 'contains', value: 'mock' }],
            },
          ],
          aggregation: 'mean',
        },
      ],
      target: { name: 'default', provider: 'mock', response: 'mock response' },
      budgetUsd: 5.0,
      beforeAll: 'echo "setup"',
    });
    expect(summary.total).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Backwards compatibility: input still works as before
  // ---------------------------------------------------------------------------

  it('still works with standard single-turn input', async () => {
    const { summary } = await evaluate({
      tests: [
        {
          id: 'standard-input',
          input: 'hello',
          assert: [{ type: 'contains', value: 'hello' }],
        },
      ],
      target: { name: 'default', provider: 'mock', response: 'hello world' },
    });
    expect(summary.passed).toBe(1);
  });

  it('uses inline target from a TypeScript specFile', async () => {
    const specFile = path.join(import.meta.dir, 'loaders', 'fixtures', 'default-export.eval.ts');

    const { summary } = await evaluate({
      specFile,
    });

    expect(summary.total).toBe(1);
    expect(summary.passed).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  it('throws when input is missing on a non-conversation test', async () => {
    expect(() =>
      evaluate({
        // biome-ignore lint/suspicious/noExplicitAny: intentionally testing invalid input
        tests: [{ id: 'no-input', assert: [{ type: 'contains', value: 'x' }] } as any],
        target: { name: 'default', provider: 'mock', response: 'hello' },
      }),
    ).toThrow("Test 'no-input': input is required for non-conversation tests");
  });
});
