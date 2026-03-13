/**
 * Programmatic API Example
 *
 * Uses Eval() from @agentv/core to run evaluations as a library.
 * No YAML needed — tests defined inline with full type safety.
 *
 * Run: bun run evaluate.ts
 * (Uses 'default' target from .agentv/targets.yaml and .env credentials)
 */
import { Contains, Eval } from '@agentv/core';

const { results, summary } = await Eval('programmatic-api-example', {
  data: [
    {
      id: 'greeting',
      input: 'Say hello and introduce yourself briefly.',
      expectedOutput: "Hello! I'm an AI assistant here to help you.",
    },
    {
      id: 'json-output',
      input: 'Return a JSON object with a "status" field set to "ok".',
      expectedOutput: '{"status": "ok"}',
    },
  ],
  target: { provider: 'mock', response: 'Hello! I am an AI assistant. {"status": "ok"}' },
  assert: [Contains('Hello'), { type: 'contains', value: 'ok' }],
});

console.log('\n--- Summary ---');
console.log(`Total: ${summary.total}`);
console.log(`Passed: ${summary.passed}`);
console.log(`Failed: ${summary.failed}`);
console.log(`Mean score: ${summary.meanScore.toFixed(2)}`);
console.log(`Duration: ${summary.durationMs}ms`);
