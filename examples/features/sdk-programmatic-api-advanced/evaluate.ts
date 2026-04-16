/**
 * Advanced Programmatic API Example
 *
 * Demonstrates evaluate() with beforeAll, budgetUsd, multi-turn conversations,
 * and aggregation — all defined in TypeScript with full type safety.
 *
 * Run: bun run evaluate.ts
 */
import { evaluate } from '@agentv/core';

const { results, summary } = await evaluate({
  // Run a setup command before the suite starts
  beforeAll: 'echo "Setting up test environment"',

  // Cap total LLM spend at $5
  budgetUsd: 5.0,

  tests: [
    // Standard single-turn test (unchanged from basic API)
    {
      id: 'greeting',
      input: 'Say hello.',
      assert: [{ type: 'contains', value: 'Hello' }],
    },

    // Multi-turn conversation test
    {
      id: 'multi-turn-memory',
      mode: 'conversation',
      turns: [
        {
          input: 'Hi, my name is Alice.',
          assert: [{ type: 'contains', value: 'Alice' }],
        },
        {
          input: 'What is my name?',
          expectedOutput: 'Your name is Alice.',
          assert: [{ type: 'contains', value: 'Alice' }],
        },
      ],
      // Use weakest-link scoring: final score = lowest turn score
      aggregation: 'min',
    },
  ],

  onResult: (result) => {
    console.log(`  ${result.testId}: score=${result.score.toFixed(2)}`);
  },
});

console.log('\n--- Summary ---');
console.log(`Total: ${summary.total}`);
console.log(`Passed: ${summary.passed}`);
console.log(`Failed: ${summary.failed}`);
console.log(`Mean score: ${summary.meanScore.toFixed(2)}`);
console.log(`Duration: ${summary.durationMs}ms`);
