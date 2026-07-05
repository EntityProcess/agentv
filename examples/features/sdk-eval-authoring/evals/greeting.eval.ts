import { defineEval, graders } from '@agentv/sdk';

export default defineEval({
  name: 'sdk-eval-authoring',
  description: 'YAML-aligned TypeScript eval authoring with @agentv/sdk',
  inputFiles: ['../fixtures/shared-context.md'],
  target: 'mock-sdk',
  environment: {
    type: 'host',
    workdir: '../fixtures',
  },
  tests: [
    {
      id: 'hello-from-typescript',
      input: 'Use the attached notes and say hello.',
      inputFiles: ['../fixtures/per-test-note.md'],
      expectedOutput: 'Hello from the mock target',
      assert: [
        graders.contains('Hello', { name: 'mentions-hello' }),
        graders.regex(/mock target/i, { name: 'mentions-mock-target' }),
      ],
    },
  ],
});
