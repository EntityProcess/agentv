import { defineEval } from '../../../../../sdk/src/index.ts';

export default defineEval({
  name: 'sdk-define-eval-suite',
  description: 'YAML-aligned TypeScript suite authored with @agentv/sdk',
  tags: ['sdk', 'typescript', 'yaml'],
  execution: {
    targets: ['mock-target'],
    workers: 2,
    skipDefaults: true,
    budgetUsd: 2,
    threshold: 0.75,
  },
  workspace: {
    hooks: {
      beforeAll: {
        command: ['echo', 'suite-setup'],
      },
    },
  },
  tests: [
    {
      id: 'sdk-define-eval',
      input: 'Say hello',
      expectedOutput: 'hello there',
      assertions: [{ type: 'contains', value: 'hello' }],
      workspace: {
        hooks: {
          beforeEach: {
            command: ['echo', 'case-setup'],
            timeoutMs: 1_000,
          },
        },
      },
    },
  ],
});
