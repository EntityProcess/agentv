/**
 * Tests for the programmatic API extensions: beforeAll, budgetUsd, turns, aggregation.
 *
 * Validates that the new EvalConfig and EvalTestInput fields are accepted by
 * evaluate() and correctly converted to internal EvalTest / RunEvaluationOptions.
 */

import { describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { evaluate } from '../../src/evaluation/evaluate.js';

const PROGRAMMATIC_API_TIMEOUT_MS = 15_000;

describe('evaluate() — programmatic API extensions', () => {
  // ---------------------------------------------------------------------------
  // budgetUsd
  // ---------------------------------------------------------------------------

  it(
    'accepts budgetUsd and passes it to the orchestrator',
    async () => {
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
    },
    PROGRAMMATIC_API_TIMEOUT_MS,
  );

  it(
    'excludes execution errors from quality summary counts',
    async () => {
      const { results, summary } = await evaluate({
        tests: [
          {
            id: 'quality-pass',
            input: 'ok',
            assert: [{ type: 'contains', value: 'task ok' }],
          },
          {
            id: 'provider-error',
            input: 'explode',
            assert: [{ type: 'contains', value: 'task ok' }],
          },
        ],
        task: async (input) => {
          if (input === 'explode') {
            throw new Error('provider unavailable');
          }
          return 'task ok';
        },
        maxRetries: 0,
      });

      expect(results.map((result) => result.executionStatus).sort()).toEqual([
        'execution_error',
        'ok',
      ]);
      expect(summary.total).toBe(2);
      expect(summary.passed).toBe(1);
      expect(summary.failed).toBe(0);
      expect(summary.executionErrors).toBe(1);
      expect(summary.meanScore).toBe(1);
    },
    PROGRAMMATIC_API_TIMEOUT_MS,
  );

  // ---------------------------------------------------------------------------
  // response cache
  // ---------------------------------------------------------------------------

  it(
    'writes response cache entries to a custom programmatic cachePath',
    async () => {
      const cachePath = mkdtempSync(path.join(tmpdir(), 'agentv-programmatic-cache-'));
      try {
        const { summary } = await evaluate({
          tests: [
            {
              id: 'programmatic-cache-path',
              input: 'hello',
              assert: [{ type: 'contains', value: 'cached' }],
            },
          ],
          target: { name: 'default', provider: 'mock', response: 'cached response' },
          cache: true,
          cachePath,
        });

        expect(summary.passed).toBe(1);
        const shardDirs = readdirSync(cachePath);
        expect(shardDirs.length).toBeGreaterThan(0);
        const firstShard = path.join(cachePath, shardDirs[0]);
        expect(existsSync(firstShard)).toBe(true);
        expect(readdirSync(firstShard).some((entry) => entry.endsWith('.json'))).toBe(true);
      } finally {
        rmSync(cachePath, { recursive: true, force: true });
      }
    },
    PROGRAMMATIC_API_TIMEOUT_MS,
  );

  // ---------------------------------------------------------------------------
  // turns + mode: 'conversation'
  // ---------------------------------------------------------------------------

  it(
    'accepts turns with explicit conversation mode',
    async () => {
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
    },
    PROGRAMMATIC_API_TIMEOUT_MS,
  );

  it(
    'infers conversation mode when turns[] is provided without explicit mode',
    async () => {
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
    },
    PROGRAMMATIC_API_TIMEOUT_MS,
  );

  it(
    'supports expectedOutput on individual turns',
    async () => {
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
    },
    PROGRAMMATIC_API_TIMEOUT_MS,
  );

  it(
    'supports message array input in turns',
    async () => {
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
    },
    PROGRAMMATIC_API_TIMEOUT_MS,
  );

  // ---------------------------------------------------------------------------
  // aggregation
  // ---------------------------------------------------------------------------

  it(
    'accepts aggregation on conversation tests',
    async () => {
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
    },
    PROGRAMMATIC_API_TIMEOUT_MS,
  );

  // ---------------------------------------------------------------------------
  // beforeAll
  // ---------------------------------------------------------------------------

  it(
    'accepts beforeAll as a string',
    async () => {
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
    },
    PROGRAMMATIC_API_TIMEOUT_MS,
  );

  it(
    'accepts beforeAll as a string array',
    async () => {
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
    },
    PROGRAMMATIC_API_TIMEOUT_MS,
  );

  // ---------------------------------------------------------------------------
  // Combined usage
  // ---------------------------------------------------------------------------

  it(
    'supports all new fields together',
    async () => {
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
    },
    PROGRAMMATIC_API_TIMEOUT_MS,
  );

  // ---------------------------------------------------------------------------
  // Backwards compatibility: input still works as before
  // ---------------------------------------------------------------------------

  it(
    'still works with standard single-turn input',
    async () => {
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
    },
    PROGRAMMATIC_API_TIMEOUT_MS,
  );

  it(
    'uses inline target from a TypeScript specFile',
    async () => {
      const specFile = path.join(import.meta.dir, 'loaders', 'fixtures', 'default-export.eval.ts');

      const { summary } = await evaluate({
        specFile,
      });

      expect(summary.total).toBe(1);
      expect(summary.passed).toBe(1);
    },
    PROGRAMMATIC_API_TIMEOUT_MS,
  );

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  it(
    'throws when input is missing on a non-conversation test',
    async () => {
      expect(() =>
        evaluate({
          // biome-ignore lint/suspicious/noExplicitAny: intentionally testing invalid input
          tests: [{ id: 'no-input', assert: [{ type: 'contains', value: 'x' }] } as any],
          target: { name: 'default', provider: 'mock', response: 'hello' },
        }),
      ).toThrow("Test 'no-input': input is required for non-conversation tests");
    },
    PROGRAMMATIC_API_TIMEOUT_MS,
  );
});
