import { defineEval, graders } from '@agentv/sdk';

export default defineEval({
  name: 'sdk-eval-authoring',
  description: 'YAML-aligned TypeScript eval authoring with @agentv/sdk',
  inputFiles: ['../fixtures/shared-context.md'],
  execution: {
    targets: ['mock-sdk'],
  },
  workspace: {
    hooks: {
      beforeAll: {
        command: ['echo', 'suite-start'],
      },
    },
  },
  tests: [
    {
      id: 'hello-from-typescript',
      input: 'Use the attached notes and say hello.',
      inputFiles: ['../fixtures/per-test-note.md'],
      expectedOutput: 'Hello from the mock target',
      assertions: [
        graders.contains('Hello', { name: 'mentions-hello' }),
        graders.regex(/mock target/i, { name: 'mentions-mock-target' }),
      ],
      workspace: {
        hooks: {
          beforeEach: {
            command: ['echo', 'per-test-setup'],
            timeoutMs: 1_000,
          },
        },
      },
    },
  ],
});
