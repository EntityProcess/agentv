import { type EvalConfig, graders } from '@agentv/sdk';

const config: EvalConfig = {
  name: 'sdk-eval-authoring',
  description: 'TypeScript eval config authoring with @agentv/sdk',
  target: 'mock-sdk',
  environment: {
    type: 'host',
    workdir: '../fixtures',
  },
  prompts: ['Use the attached notes and {{ task }}'],
  tests: [
    {
      id: 'hello-from-typescript',
      vars: {
        task: 'say hello.',
      },
      inputFiles: ['../fixtures/per-test-note.md'],
      assert: [
        graders.contains('Hello', { name: 'mentions-hello' }),
        graders.regex(/mock target/i, { name: 'mentions-mock-target' }),
      ],
    },
  ],
};

export default config;
