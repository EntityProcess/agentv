/**
 * Programmatic API Example
 *
 * Uses evaluate() from @agentv/core to run evaluations as a library.
 * No YAML needed — tests defined inline with full type safety.
 *
 * Run: bun run evaluate.ts
 * (Uses 'default' target from .agentv/targets.yaml and .env credentials)
 */
import { evaluate } from '@agentv/core';

const { results, summary } = await evaluate({
  tests: [
    {
      id: 'greeting',
      input: 'Say hello and introduce yourself briefly.',
      expected_output: "Hello! I'm an AI assistant here to help you.",
      assert: [{ type: 'contains', value: 'Hello' }],
    },
    {
      id: 'json-output',
      input: [
        { role: 'system', content: 'Respond only with valid JSON. No markdown.' },
        { role: 'user', content: 'Return a JSON object with a "status" field set to "ok".' },
      ],
      expected_output: '{"status": "ok"}',
      assert: [
        { type: 'is_json', required: true },
        { type: 'contains', value: 'ok' },
      ],
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
