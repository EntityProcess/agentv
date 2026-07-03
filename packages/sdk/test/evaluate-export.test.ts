import { describe, expect, it } from 'bun:test';

import { evaluate } from '../src/index.js';

describe('evaluate export', () => {
  it('runs the core programmatic evaluate API through @agentv/sdk', async () => {
    const { results, summary } = await evaluate({
      tests: [
        {
          id: 'sdk-evaluate-export',
          input: 'Say hello',
          assert: [{ type: 'contains', value: 'hello' }],
        },
      ],
      task: async (input) => `hello: ${input}`,
    });

    expect(summary.total).toBe(1);
    expect(summary.passed).toBe(1);
    expect(results[0].testId).toBe('sdk-evaluate-export');
  });
});
