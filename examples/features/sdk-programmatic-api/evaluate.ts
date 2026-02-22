/**
 * Programmatic API Example
 *
 * Uses evaluate() from @agentv/core to run evaluations as a library.
 * No YAML needed — tests defined inline with full type safety.
 */
import { evaluate } from '@agentv/core';

const { results, summary } = await evaluate({
  tests: [
    {
      id: 'greeting',
      input: 'Say hello to the user',
      expected_output: "Hello! I'm here to help you.",
      assert: [
        { type: 'contains', value: 'Hello' },
        { type: 'contains', value: 'help' },
      ],
    },
    {
      id: 'math',
      input: 'What is 2+2?',
      expected_output: '4',
      assert: [{ type: 'equals', value: '4' }],
    },
    {
      id: 'json-output',
      input: 'Return a JSON object with status ok',
      expected_output: '{"status": "ok"}',
      assert: [
        { type: 'is_json', required: true },
        { type: 'contains', value: 'ok' },
      ],
    },
  ],
  target: { name: 'default', provider: 'mock_agent' },
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
