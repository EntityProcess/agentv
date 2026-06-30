/**
 * Programmatic API Example
 *
 * Uses evaluate() from @agentv/sdk to run evaluations as a library.
 * The inline config mirrors the canonical YAML surface with TypeScript-friendly names.
 *
 * Run: bun run evaluate.ts
 * (Uses 'default' target from .agentv/targets.yaml and .env credentials)
 */
import { evaluate } from '@agentv/sdk';

const { results, summary } = await evaluate({
  tests: [
    {
      id: 'greeting',
      input: 'Say hello and introduce yourself briefly.',
      expectedOutput: "Hello! I'm an AI assistant here to help you.",
      assertions: [{ type: 'contains', value: 'Hello' }],
    },
    {
      id: 'json-output',
      input: [
        { role: 'system', content: 'Respond only with valid JSON. No markdown.' },
        { role: 'user', content: 'Return a JSON object with a "status" field set to "ok".' },
      ],
      expectedOutput: '{"status": "ok"}',
      assertions: [
        { type: 'is-json', required: true },
        { type: 'contains', value: 'ok' },
      ],
    },
  ],
  onResult: (result) => {
    console.log(`  ${result.testId}: score=${result.score.toFixed(2)}`);
  },
  outputDir: '.agentv/results/sdk-programmatic-api-example',
  experiment: 'sdk-programmatic-api',
});

console.log('\n--- Summary ---');
console.log(`Total: ${summary.total}`);
console.log(`Passed: ${summary.passed}`);
console.log(`Failed: ${summary.failed}`);
console.log(`Mean score: ${summary.meanScore.toFixed(2)}`);
console.log(`Duration: ${summary.durationMs}ms`);
console.log('Artifacts: .agentv/results/sdk-programmatic-api-example');
